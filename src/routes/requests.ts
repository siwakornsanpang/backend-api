import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { requests, requestShippingDetails, requestPaymentLogs, requestTaxInvoices, pharmacists } from '../db/schema';
import { eq, and, ilike, or, desc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';

export async function requestRoutes(app: FastifyInstance) {

  // GET /requests - ดึงรายการคำขอทั้งหมด (Admin/Editor)
  app.get('/requests', { preHandler: [verifyToken, requirePermission('manage_register')] }, async (req, reply) => {
    const { status, q } = req.query as { status?: string; q?: string };
    
    const conditions = [];
    if (status) conditions.push(eq(requests.requestStatus, status as any));
    if (q) {
      conditions.push(
        or(
          ilike(requests.id, `%${q}%`),
          ilike(requests.pharmacistLicenseId, `%${q}%`)
        )
      );
    }

    const result = await db.select().from(requests)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(requests.createdAt));
      
    return result;
  });

  // GET /requests/:id - ดึงข้อมูลคำขอแบบละเอียดพร้อมข้อมูลที่เกี่ยวข้อง
  app.get('/requests/:id', { preHandler: [verifyToken, requirePermission('manage_register')] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const requestData = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
    if (requestData.length === 0) return reply.status(404).send({ message: 'ไม่พบข้อมูลคำขอ' });

    const shipping = await db.select().from(requestShippingDetails).where(eq(requestShippingDetails.requestId, id)).limit(1);
    const payment = await db.select().from(requestPaymentLogs).where(eq(requestPaymentLogs.requestId, id));
    const taxInvoice = await db.select().from(requestTaxInvoices).where(eq(requestTaxInvoices.requestId, id)).limit(1);
    
    // ดึงข้อมูลเภสัชกรจากเลขใบอนุญาต
    const pharmacist = await db.select().from(pharmacists).where(eq(pharmacists.registrationId, requestData[0].pharmacistLicenseId)).limit(1);

    return {
      ...requestData[0],
      shippingDetails: shipping[0] || null,
      paymentLogs: payment,
      taxInvoice: taxInvoice[0] || null,
      pharmacist: pharmacist[0] || null
    };
  });

  // POST /requests - สร้างคำขอใหม่ (พร้อมข้อมูลจัดส่ง และอื่นๆ)
  app.post('/requests', { preHandler: [verifyToken] }, async (req, reply) => {
    const { 
      id, pharmacistLicenseId, licenseType, 
      shippingDetails, taxInvoice 
    } = req.body as any;

    if (!id || !pharmacistLicenseId) {
      return reply.status(400).send({ message: 'กรุณากรอก Request ID และเลขใบอนุญาตเภสัชกร' });
    }

    try {
      const result = await db.transaction(async (tx) => {
        // 1. สร้างหัวข้อคำขอ
        const [newRequest] = await tx.insert(requests).values({
          id,
          pharmacistLicenseId,
          licenseType,
          requestStatus: 'draft',
        }).returning();

        // 2. ถ้ามีข้อมูลจัดส่ง ให้สร้างด้วย
        if (shippingDetails) {
          await tx.insert(requestShippingDetails).values({
            requestId: id,
            shippingAddress: shippingDetails.shippingAddress,
            trackingNumber: shippingDetails.trackingNumber,
          });
        }

        // 3. ถ้ามีข้อมูลใบกำกับภาษี ให้สร้างด้วย
        if (taxInvoice) {
          await tx.insert(requestTaxInvoices).values({
            requestId: id,
            taxpayerType: taxInvoice.taxpayerType,
            taxInvoiceName: taxInvoice.taxInvoiceName,
            taxIdNumber: taxInvoice.taxIdNumber,
            branchCode: taxInvoice.branchCode,
            registeredTaxAddress: taxInvoice.registeredTaxAddress,
            taxInvoiceNumber: taxInvoice.taxInvoiceNumber,
          });
        }

        return newRequest;
      });

      return { success: true, data: result };
    } catch (err: any) {
      console.error(err);
      if (err.code === '23505') return reply.status(409).send({ message: 'Request ID นี้มีอยู่ในระบบแล้ว' });
      return reply.status(500).send({ message: 'ไม่สามารถสร้างคำขอได้' });
    }
  });

  // PUT /requests/:id - อัปเดตสถานะหรือข้อมูลคำขอ
  app.put('/requests/:id', { preHandler: [verifyToken, requirePermission('manage_register')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { requestStatus, licenseType, shippingDetails, taxInvoice } = req.body as any;

    try {
      await db.transaction(async (tx) => {
        // อัปเดตข้อมูลหลัก
        await tx.update(requests)
          .set({ 
            requestStatus, 
            licenseType,
            updatedAt: new Date()
          })
          .where(eq(requests.id, id));

        // อัปเดตข้อมูลจัดส่ง
        if (shippingDetails) {
          const existingShipping = await tx.select().from(requestShippingDetails).where(eq(requestShippingDetails.requestId, id)).limit(1);
          if (existingShipping.length > 0) {
            await tx.update(requestShippingDetails)
              .set({ ...shippingDetails, updatedAt: new Date() })
              .where(eq(requestShippingDetails.requestId, id));
          } else {
            await tx.insert(requestShippingDetails).values({ ...shippingDetails, requestId: id });
          }
        }

        // อัปเดตข้อมูลใบกำกับภาษี
        if (taxInvoice) {
          const existingTax = await tx.select().from(requestTaxInvoices).where(eq(requestTaxInvoices.requestId, id)).limit(1);
          if (existingTax.length > 0) {
            await tx.update(requestTaxInvoices)
              .set({ ...taxInvoice, updatedAt: new Date() })
              .where(eq(requestTaxInvoices.requestId, id));
          } else {
            await tx.insert(requestTaxInvoices).values({ ...taxInvoice, requestId: id });
          }
        }
      });

      return { success: true };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'ไม่สามารถอัปเดตข้อมูลได้' });
    }
  });

  // POST /requests/:id/payment - บันทึกการชำระเงิน
  app.post('/requests/:id/payment', { preHandler: [verifyToken] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { paymentDate, amountPaid, paymentMethod, paymentReferenceId } = req.body as any;

    try {
      const result = await db.insert(requestPaymentLogs).values({
        requestId: id,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        amountPaid: amountPaid ? amountPaid.toString() : "0",
        paymentMethod,
        paymentReferenceId
      }).returning();

      return { success: true, data: result[0] };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'ไม่สามารถบันทึกการชำระเงินได้' });
    }
  });

  // DELETE /requests/:id
  app.delete('/requests/:id', { preHandler: [verifyToken, requirePermission('manage_register')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(requests).where(eq(requests.id, id));
    return { success: true, message: 'ลบข้อมูลคำขอเรียบร้อย' };
  });
}

// src/routes/services.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { services } from '../db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function serviceRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูลทั้งหมด (เรียงตาม order)
  app.get('/services', async (req, reply) => {
    return await db.select()
      .from(services)
      .orderBy(asc(services.order));
  });

  // 2. GET: ดึงเฉพาะบริการเด่น (popular) สูงสุด 4 รายการ
  app.get('/services/popular', async (req, reply) => {
    return await db.select()
      .from(services)
      .where(eq(services.isPopular, true))
      .orderBy(asc(services.popularOrder))
      .limit(4);
  });

  // 3. POST: สร้างข้อมูลใหม่ (multipart: icon file + fields)
  app.post('/services', { preHandler: [verifyToken, requirePermission('manage_service')] }, async (req, reply) => {
    const parts = req.parts();
    let name = '', shortName = '', description = '', linkUrl = '', order = 99;
    let isPopular = false, popularOrder = 0;
    let iconUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'icon') {
          const url = await uploadToStorage('service', buffer, part.filename, part.mimetype, 'icon');
          if (url) iconUrl = url;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'shortName') shortName = part.value as string;
        if (part.fieldname === 'description') description = part.value as string;
        if (part.fieldname === 'linkUrl') linkUrl = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'isPopular') isPopular = (part.value as string) === 'true';
        if (part.fieldname === 'popularOrder') popularOrder = parseInt(part.value as string) || 0;
      }
    }

    await db.insert(services).values({
      name,
      shortName: shortName || null,
      iconUrl: iconUrl || null,
      order,
      description: description || null,
      linkUrl: linkUrl || null,
      isPopular,
      popularOrder,
    });
    return { success: true };
  });

  // 4. PUT: แก้ไขข้อมูล
  app.put('/services/:id', { preHandler: [verifyToken, requirePermission('manage_service')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    const oldData = await db.select().from(services).where(eq(services.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    let name: string | undefined, shortName: string | undefined, description: string | undefined;
    let linkUrl: string | undefined, order: number | undefined;
    let isPopular: boolean | undefined, popularOrder: number | undefined;
    let iconUrl: string | undefined;

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'icon') {
          const url = await uploadToStorage('service', buffer, part.filename, part.mimetype, 'icon');
          if (url) iconUrl = url;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'shortName') shortName = part.value as string;
        if (part.fieldname === 'description') description = part.value as string;
        if (part.fieldname === 'linkUrl') linkUrl = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'isPopular') isPopular = (part.value as string) === 'true';
        if (part.fieldname === 'popularOrder') popularOrder = parseInt(part.value as string) || 0;
      }
    }

    // ลบ icon เก่าถ้ามี icon ใหม่
    if (iconUrl && oldData[0].iconUrl) {
      await deleteFromStorage([oldData[0].iconUrl]);
    }

    await db.update(services).set({
      name: name ?? oldData[0].name,
      shortName: shortName !== undefined ? (shortName || null) : oldData[0].shortName,
      iconUrl: iconUrl || oldData[0].iconUrl,
      order: order ?? oldData[0].order,
      description: description !== undefined ? (description || null) : oldData[0].description,
      linkUrl: linkUrl !== undefined ? (linkUrl || null) : oldData[0].linkUrl,
      isPopular: isPopular !== undefined ? isPopular : oldData[0].isPopular,
      popularOrder: popularOrder !== undefined ? popularOrder : oldData[0].popularOrder,
    }).where(eq(services.id, parseInt(id)));

    return { success: true };
  });

  // 5. PUT: อัปเดตลำดับ (Reorder)
  app.put('/services/reorder', { preHandler: [verifyToken, requirePermission('manage_service')] }, async (req, reply) => {
    const items = req.body as { id: number; order: number }[];
    if (!Array.isArray(items)) {
      return reply.status(400).send({ message: 'Invalid format' });
    }

    for (const item of items) {
      await db.update(services)
        .set({ order: item.order })
        .where(eq(services.id, item.id));
    }

    return { success: true };
  });

  // 6. DELETE: ลบ + ลบ icon เก่า
  app.delete('/services/:id', { preHandler: [verifyToken, requirePermission('manage_service')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const serviceId = parseInt(id);

    const target = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
    if (target.length > 0 && target[0].iconUrl) {
      await deleteFromStorage([target[0].iconUrl]);
    }

    await db.delete(services).where(eq(services.id, serviceId));
    return { success: true };
  });
}

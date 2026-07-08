// src/routes/otherService.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { otherServiceCategories, otherServiceItems } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function otherServiceRoutes(app: FastifyInstance) {

  // =============================================================
  // CATEGORIES
  // =============================================================

  // GET: ดึงหมวดหมู่ทั้งหมด
  app.get('/other-service-categories', async () => {
    return await db.select().from(otherServiceCategories).orderBy(asc(otherServiceCategories.order), asc(otherServiceCategories.id));
  });

  // GET: ดึงหมวดหมู่พร้อมจำนวนรายการ
  app.get('/other-service-categories/with-count', async () => {
    const categories = await db.select().from(otherServiceCategories).orderBy(asc(otherServiceCategories.order), asc(otherServiceCategories.id));

    const result = await Promise.all(categories.map(async (cat) => {
      const items = await db.select().from(otherServiceItems).where(eq(otherServiceItems.categoryId, cat.id));
      return { ...cat, itemCount: items.length };
    }));

    return result;
  });

  // POST: สร้างหมวดหมู่ใหม่
  app.post('/other-service-categories', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const { name } = req.body as { name: string };
    if (!name || !name.trim()) {
      return reply.status(400).send({ message: 'กรุณาระบุชื่อหมวดหมู่' });
    }

    // หา order สูงสุด
    const all = await db.select().from(otherServiceCategories);
    const maxOrder = all.length > 0 ? Math.max(...all.map(c => c.order)) : -1;

    const result = await db.insert(otherServiceCategories).values({
      name: name.trim(),
      order: maxOrder + 1,
    }).returning();

    return { success: true, category: result[0] };
  });

  // PUT: แก้ไขหมวดหมู่
  app.put('/other-service-categories/:id', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name } = req.body as { name?: string };

    const existing = await db.select().from(otherServiceCategories).where(eq(otherServiceCategories.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'ไม่พบหมวดหมู่' });

    await db.update(otherServiceCategories).set({
      name: name?.trim() || existing[0].name,
    }).where(eq(otherServiceCategories.id, parseInt(id)));

    return { success: true };
  });

  // DELETE: ลบหมวดหมู่ (cascade ลบรายการภายในด้วย)
  app.delete('/other-service-categories/:id', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const catId = parseInt(id);

    // ลบไฟล์ PDF ของรายการทั้งหมดในหมวดนี้ก่อน
    const items = await db.select().from(otherServiceItems).where(eq(otherServiceItems.categoryId, catId));
    const pdfUrls = items.map(item => item.pdfUrl).filter(Boolean) as string[];
    if (pdfUrls.length > 0) {
      await deleteFromStorage(pdfUrls).catch(e => console.error('Error deleting PDFs:', e));
    }

    await db.delete(otherServiceCategories).where(eq(otherServiceCategories.id, catId));
    return { success: true };
  });

  // PUT: Reorder หมวดหมู่
  app.put('/other-service-categories/reorder', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const { items } = req.body as { items: { id: number; order: number }[] };
    if (!Array.isArray(items)) return reply.status(400).send({ message: 'Invalid items' });

    for (const item of items) {
      await db.update(otherServiceCategories).set({ order: item.order }).where(eq(otherServiceCategories.id, item.id));
    }
    return { success: true };
  });


  // =============================================================
  // ITEMS (PDF Files within a category)
  // =============================================================

  // GET: ดึงรายการทั้งหมดในหมวดหมู่หนึ่ง
  app.get('/other-service-items/:categoryId', async (req, reply) => {
    const { categoryId } = req.params as { categoryId: string };
    return await db.select().from(otherServiceItems)
      .where(eq(otherServiceItems.categoryId, parseInt(categoryId)))
      .orderBy(asc(otherServiceItems.order), asc(otherServiceItems.id));
  });

  // GET: ดึงรายการทั้งหมด (ทุกหมวด) — สำหรับ public
  app.get('/other-service-items', async () => {
    return await db.select().from(otherServiceItems)
      .orderBy(asc(otherServiceItems.categoryId), asc(otherServiceItems.order));
  });

  // POST: เพิ่มรายการใหม่ (พร้อมอัปโหลด PDF)
  app.post('/other-service-items', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const parts = req.parts();
    let name = '', categoryId = 0, status = 'online', pdfUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('other-service', buffer, part.filename, part.mimetype);
        if (url) pdfUrl = url;
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'categoryId') categoryId = parseInt(part.value as string) || 0;
        if (part.fieldname === 'status') status = part.value as string;
      }
    }

    if (!name.trim() || !categoryId) {
      return reply.status(400).send({ message: 'กรุณาระบุชื่อบริการและหมวดหมู่' });
    }

    // หา order สูงสุดในหมวดนี้
    const existing = await db.select().from(otherServiceItems).where(eq(otherServiceItems.categoryId, categoryId));
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(i => i.order)) : -1;

    const result = await db.insert(otherServiceItems).values({
      name: name.trim(),
      categoryId,
      status,
      pdfUrl: pdfUrl || null,
      order: maxOrder + 1,
    }).returning();

    return { success: true, item: result[0] };
  });

  // PUT: แก้ไขรายการ (รองรับเปลี่ยนไฟล์ PDF)
  app.put('/other-service-items/:id', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const itemId = parseInt(id);
    const parts = req.parts();

    let name: string | undefined;
    let status: string | undefined;
    let pdfUrl: string | undefined;
    let hasNewFile = false;
    let removePdf = false;

    const existing = await db.select().from(otherServiceItems).where(eq(otherServiceItems.id, itemId)).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'ไม่พบรายการ' });

    for await (const part of parts) {
      if (part.type === 'file') {
        hasNewFile = true;
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('other-service', buffer, part.filename, part.mimetype);
        if (url) pdfUrl = url;
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'status') status = part.value as string;
        if (part.fieldname === 'removePdf' && part.value === 'true') removePdf = true;
      }
    }

    // ลบ PDF เก่าถ้ามีไฟล์ใหม่หรือต้องการลบ
    const urlsToDelete: string[] = [];
    if (hasNewFile && existing[0].pdfUrl) urlsToDelete.push(existing[0].pdfUrl);
    if (removePdf && existing[0].pdfUrl) urlsToDelete.push(existing[0].pdfUrl);
    if (urlsToDelete.length > 0) deleteFromStorage(urlsToDelete).catch(e => console.error('Error deleting old PDF:', e));

    // กำหนด pdfUrl สุดท้าย
    let finalPdfUrl = existing[0].pdfUrl;
    if (hasNewFile) finalPdfUrl = pdfUrl || null;
    if (removePdf && !hasNewFile) finalPdfUrl = null;

    await db.update(otherServiceItems).set({
      name: name !== undefined ? name.trim() : existing[0].name,
      status: status !== undefined ? status : existing[0].status,
      pdfUrl: finalPdfUrl,
    }).where(eq(otherServiceItems.id, itemId));

    return { success: true };
  });

  // DELETE: ลบรายการ
  app.delete('/other-service-items/:id', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const itemId = parseInt(id);

    // ลบไฟล์ PDF จาก storage
    const existing = await db.select().from(otherServiceItems).where(eq(otherServiceItems.id, itemId)).limit(1);
    if (existing.length > 0 && existing[0].pdfUrl) {
      await deleteFromStorage([existing[0].pdfUrl]).catch(e => console.error('Error deleting PDF:', e));
    }

    await db.delete(otherServiceItems).where(eq(otherServiceItems.id, itemId));
    return { success: true };
  });

  // PUT: Reorder รายการ
  app.put('/other-service-items/reorder', { preHandler: [verifyToken, requirePermission('manage_other_service')] }, async (req, reply) => {
    const { items } = req.body as { items: { id: number; order: number }[] };
    if (!Array.isArray(items)) return reply.status(400).send({ message: 'Invalid items' });

    for (const item of items) {
      await db.update(otherServiceItems).set({ order: item.order }).where(eq(otherServiceItems.id, item.id));
    }
    return { success: true };
  });
}

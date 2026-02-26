// src/routes/agencies.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { agencies } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage } from '../utils/upload';

export async function agencyRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล (รองรับการกรองตาม category)
  app.get('/agencies', async (req, reply) => {
    const { category } = req.query as { category?: string };
    let query = db.select().from(agencies);
    if (category) {
      // @ts-ignore
      query = query.where(eq(agencies.category, category));
    }
    return await query.orderBy(asc(agencies.order));
  });

  // 2. POST: เพิ่มข้อมูลใหม่
  app.post('/agencies', { preHandler: [verifyToken, requirePermission('manage_agency')] }, async (req, reply) => {
    const parts = req.parts();
    const data: any = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('agencies', buffer, part.filename, part.mimetype);
        if (url) data.imageUrl = url;
      } else {
        data[part.fieldname] = part.value;
      }
    }

    if (data.order) data.order = parseInt(data.order);

    await db.insert(agencies).values({
      name: data.name,
      description: data.description,
      url: data.url,
      category: data.category,
      order: data.order || 0,
      imageUrl: data.imageUrl,
    });
    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูล
  app.put('/agencies/:id', { preHandler: [verifyToken, requirePermission('manage_agency')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    const updateData: any = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('agencies', buffer, part.filename, part.mimetype);
        if (url) updateData.imageUrl = url;
      } else {
        updateData[part.fieldname] = part.value;
      }
    }

    if (updateData.order) updateData.order = parseInt(updateData.order);

    await db.update(agencies).set(updateData).where(eq(agencies.id, parseInt(id)));
    return { success: true };
  });

  // 4. DELETE: ลบข้อมูล
  app.delete('/agencies/:id', { preHandler: [verifyToken, requirePermission('manage_agency')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(agencies).where(eq(agencies.id, parseInt(id)));
    return { success: true };
  });
}
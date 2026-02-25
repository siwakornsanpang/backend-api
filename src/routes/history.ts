// src/routes/history.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { councilHistory } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { verifyToken, requireRole } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function historyRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล
  app.get('/history', async (req, reply) => {
    return await db.select().from(councilHistory).orderBy(desc(councilHistory.id));
  });

  // 2. POST: สร้างใหม่
  app.post('/history', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const parts = req.parts();
    let term = '', years = '', presidentName = '', secretaryName = '';
    let presidentImage = '', secretaryImage = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('history', buffer, part.filename, part.mimetype, part.fieldname);
        if (url) {
          if (part.fieldname === 'presidentImage') presidentImage = url;
          if (part.fieldname === 'secretaryImage') secretaryImage = url;
        }
      } else {
        if (part.fieldname === 'term') term = part.value as string;
        if (part.fieldname === 'years') years = part.value as string;
        if (part.fieldname === 'presidentName') presidentName = part.value as string;
        if (part.fieldname === 'secretaryName') secretaryName = part.value as string;
      }
    }

    await db.insert(councilHistory).values({
      term, years, presidentName, secretaryName, presidentImage, secretaryImage,
    });
    return { success: true };
  });

  // 3. PUT: แก้ไข
  app.put('/history/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    const oldData = await db.select().from(councilHistory).where(eq(councilHistory.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    const updateData: any = { ...oldData[0] };

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('history', buffer, part.filename, part.mimetype, part.fieldname);
        if (url) {
          if (part.fieldname === 'presidentImage') updateData.presidentImage = url;
          if (part.fieldname === 'secretaryImage') updateData.secretaryImage = url;
        }
      } else {
        if (part.fieldname === 'term') updateData.term = part.value as string;
        if (part.fieldname === 'years') updateData.years = part.value as string;
        if (part.fieldname === 'presidentName') updateData.presidentName = part.value as string;
        if (part.fieldname === 'secretaryName') updateData.secretaryName = part.value as string;
      }
    }

    await db.update(councilHistory).set({
      term: updateData.term,
      years: updateData.years,
      presidentName: updateData.presidentName,
      secretaryName: updateData.secretaryName,
      presidentImage: updateData.presidentImage,
      secretaryImage: updateData.secretaryImage,
    }).where(eq(councilHistory.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE: ลบ
  app.delete('/history/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const memberId = parseInt(id);

    const target = await db.select().from(councilHistory).where(eq(councilHistory.id, memberId)).limit(1);
    if (target.length > 0) {
      await deleteFromStorage([target[0].presidentImage, target[0].secretaryImage]);
    }

    await db.delete(councilHistory).where(eq(councilHistory.id, memberId));
    return { success: true };
  });
}
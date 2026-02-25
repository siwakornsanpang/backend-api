// src/routes/laws.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { laws } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { verifyToken, requireRole } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage } from '../utils/upload';

export async function lawRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล
  app.get('/laws/:category', async (req, reply) => {
    const { category } = req.params as { category: string };
    return await db.select().from(laws)
      .where(eq(laws.category, category))
      .orderBy(asc(laws.order));
  });

  // 2. POST: เพิ่มข้อมูลใหม่
  app.post('/laws', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const parts = req.parts();
    let title = '', category = '', announcedAt = '', order = 0, pdfUrl = '', status = 'online';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('laws', buffer, part.filename, part.mimetype);
        if (url) pdfUrl = url;
      } else {
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
        if (part.fieldname === 'status') status = part.value as string;
      }
    }

    await db.insert(laws).values({ title, category, announcedAt, order, pdfUrl, status });
    return { success: true };
  });

  // 3. PUT: แก้ไข
  app.put('/laws/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    let title, announcedAt, order, status, pdfUrl;
    let hasNewFile = false;

    const existing = await db.select().from(laws).where(eq(laws.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

    for await (const part of parts) {
      if (part.type === 'file') {
        hasNewFile = true;
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('laws', buffer, part.filename, part.mimetype);
        if (url) pdfUrl = url;
      } else {
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'status') status = part.value as string;
      }
    }

    await db.update(laws).set({
      title: title !== undefined ? title : existing[0].title,
      announcedAt: announcedAt !== undefined ? (announcedAt === '' ? null : announcedAt) : existing[0].announcedAt,
      order: order !== undefined ? (isNaN(order) ? 0 : order) : existing[0].order,
      status: status !== undefined ? status : existing[0].status,
      ...(hasNewFile ? { pdfUrl } : {}),
    }).where(eq(laws.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE
  app.delete('/laws/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(laws).where(eq(laws.id, parseInt(id)));
    return { success: true };
  });
}
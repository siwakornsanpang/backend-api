// src/routes/council.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { councilMembers } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { verifyToken, requireRole } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function councilRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล
  app.get('/council', async (req, reply) => {
    return await db.select()
      .from(councilMembers)
      .orderBy(asc(councilMembers.type), asc(councilMembers.order));
  });

  // 2. POST: สร้างข้อมูลใหม่
  app.post('/council', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const parts = req.parts();
    let name = '', position = '', type = 'elected', order = 99, imageUrl = '', background = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('council', buffer, part.filename, part.mimetype);
        if (url) imageUrl = url;
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'position') position = part.value as string;
        if (part.fieldname === 'type') type = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'background') background = part.value as string;
      }
    }

    await db.insert(councilMembers).values({ name, position, type, order, imageUrl });
    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูล
  app.put('/council/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    const oldData = await db.select().from(councilMembers).where(eq(councilMembers.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    let name, position, type, order, imageUrl, background;

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('council', buffer, part.filename, part.mimetype);
        if (url) imageUrl = url;
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'position') position = part.value as string;
        if (part.fieldname === 'type') type = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'background') background = part.value as string;
      }
    }

    await db.update(councilMembers).set({
      name: name || oldData[0].name,
      position: position || oldData[0].position,
      type: type || oldData[0].type,
      order: order !== undefined ? order : oldData[0].order,
      imageUrl: imageUrl || oldData[0].imageUrl,
      background: background !== undefined ? background : oldData[0].background,
    }).where(eq(councilMembers.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE: ลบ
  app.delete('/council/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const memberId = parseInt(id);

    const target = await db.select().from(councilMembers).where(eq(councilMembers.id, memberId)).limit(1);
    if (target.length > 0 && target[0].imageUrl) {
      await deleteFromStorage([target[0].imageUrl]);
    }

    await db.delete(councilMembers).where(eq(councilMembers.id, memberId));
    return { success: true };
  });
}
// src/routes/honor.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { honors } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function honorRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูลทั้งหมด
  app.get('/honor', async (req, reply) => {
    return await db.select()
      .from(honors)
      .orderBy(asc(honors.order));
  });

  // 2. POST: สร้างข้อมูลใหม่
  app.post('/honor', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const parts = req.parts();
    let prefix = '', name = '', awardName = '', workName = '', awardDetail = '', order = 99;
    let imageUrl = '', originalImageUrl = '', videoUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'video') {
          const url = await uploadToStorage('honor', buffer, part.filename, part.mimetype, 'video');
          if (url) videoUrl = url;
        } else if (part.fieldname === 'originalImage') {
          const url = await uploadToStorage('honor', buffer, part.filename, part.mimetype, 'originalImage');
          if (url) originalImageUrl = url;
        } else {
          const url = await uploadToStorage('honor', buffer, part.filename, part.mimetype, 'image');
          if (url) imageUrl = url;
        }
      } else {
        if (part.fieldname === 'prefix') prefix = part.value as string;
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'awardName') awardName = part.value as string;
        if (part.fieldname === 'workName') workName = part.value as string;
        if (part.fieldname === 'awardDetail') awardDetail = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    await db.insert(honors).values({
      order,
      prefix: prefix || null,
      name,
      awardName,
      workName: workName || null,
      awardDetail: awardDetail || null,
      imageUrl: imageUrl || null,
      originalImageUrl: originalImageUrl || null,
      videoUrl: videoUrl || null,
    });
    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูล
  app.put('/honor/:id', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    const oldData = await db.select().from(honors).where(eq(honors.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    let prefix, name, awardName, workName, awardDetail, order;
    let imageUrl: string | undefined, originalImageUrl: string | undefined, videoUrl: string | undefined;

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'video') {
          const url = await uploadToStorage('honor', buffer, part.filename, part.mimetype, 'video');
          if (url) videoUrl = url;
        } else if (part.fieldname === 'originalImage') {
          const url = await uploadToStorage('honor', buffer, part.filename, part.mimetype, 'originalImage');
          if (url) originalImageUrl = url;
        } else {
          const url = await uploadToStorage('honor', buffer, part.filename, part.mimetype, 'image');
          if (url) imageUrl = url;
        }
      } else {
        if (part.fieldname === 'prefix') prefix = part.value as string;
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'awardName') awardName = part.value as string;
        if (part.fieldname === 'workName') workName = part.value as string;
        if (part.fieldname === 'awardDetail') awardDetail = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    // ลบไฟล์เก่าถ้ามีไฟล์ใหม่
    const urlsToDelete: string[] = [];
    if (imageUrl && oldData[0].imageUrl) urlsToDelete.push(oldData[0].imageUrl);
    if (originalImageUrl && oldData[0].originalImageUrl) urlsToDelete.push(oldData[0].originalImageUrl);
    if (videoUrl && oldData[0].videoUrl) urlsToDelete.push(oldData[0].videoUrl);
    if (urlsToDelete.length > 0) deleteFromStorage(urlsToDelete);

    await db.update(honors).set({
      prefix: prefix !== undefined ? prefix : oldData[0].prefix,
      name: name || oldData[0].name,
      awardName: awardName || oldData[0].awardName,
      workName: workName !== undefined ? workName : oldData[0].workName,
      awardDetail: awardDetail !== undefined ? awardDetail : oldData[0].awardDetail,
      order: order !== undefined ? order : oldData[0].order,
      imageUrl: imageUrl || oldData[0].imageUrl,
      originalImageUrl: originalImageUrl !== undefined ? (originalImageUrl || oldData[0].originalImageUrl) : oldData[0].originalImageUrl,
      videoUrl: videoUrl || oldData[0].videoUrl,
    }).where(eq(honors.id, parseInt(id)));

    return { success: true };
  });

  // 4. PUT: อัปเดตลำดับ (Reorder)
  app.put('/honor/reorder', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const items = req.body as { id: number; order: number }[];
    if (!Array.isArray(items)) {
      return reply.status(400).send({ message: 'Invalid format' });
    }

    for (const item of items) {
      await db.update(honors)
        .set({ order: item.order })
        .where(eq(honors.id, item.id));
    }

    return { success: true };
  });

  // 5. DELETE: ลบ + ลบไฟล์เก่า (รูป + วิดีโอ)
  app.delete('/honor/:id', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const honorId = parseInt(id);

    const target = await db.select().from(honors).where(eq(honors.id, honorId)).limit(1);
    if (target.length > 0) {
      // ลบทั้ง cropped + original + video
      await deleteFromStorage([target[0].imageUrl, target[0].originalImageUrl, target[0].videoUrl]);
    }

    await db.delete(honors).where(eq(honors.id, honorId));
    return { success: true };
  });
}

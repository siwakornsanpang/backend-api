// src/routes/honor.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { honors } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

function emptyToNull(value?: string | null) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function emptyHtmlToNull(value?: string | null) {
  if (value === undefined || value === null) return null;
  const text = value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return text === '' ? null : value;
}

export async function honorRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูลทั้งหมด (filter by awardId)
  app.get('/honor', async (req, reply) => {
    const { awardId } = req.query as { awardId?: string };

    let query = db.select()
      .from(honors)
      .orderBy(asc(honors.order));

    if (awardId) {
      query = query.where(eq(honors.awardId, parseInt(awardId))) as any;
    }

    return await query;
  });

  // 2. POST: สร้างข้อมูลใหม่
  app.post('/honor', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const parts = req.parts();
    let prefix = '', name = '', awardName = '', workName = '', awardDetail = '', fullDetail = '', videoUrl = '', order = 99;
    let awardId = 0;
    let imageUrl = '', originalImageUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        if (part.fieldname === 'video') {
          // วิดีโอเปลี่ยนเป็นลิงก์ YouTube — ไม่รับไฟล์อัปโหลดแล้ว
          await streamToBuffer(part.file);
          continue;
        }
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'originalImage') {
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
        if (part.fieldname === 'fullDetail') fullDetail = part.value as string;
        if (part.fieldname === 'videoUrl') videoUrl = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'awardId') awardId = parseInt(part.value as string);
      }
    }

    await db.insert(honors).values({
      awardId,
      order,
      prefix: prefix || null,
      name,
      awardName,
      workName: workName || null,
      awardDetail: awardDetail || null,
      fullDetail: emptyHtmlToNull(fullDetail),
      imageUrl: imageUrl || null,
      originalImageUrl: originalImageUrl || null,
      videoUrl: emptyToNull(videoUrl),
    });
    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูล
  app.put('/honor/:id', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    const oldData = await db.select().from(honors).where(eq(honors.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    let prefix, name, awardName, workName, awardDetail, fullDetail, videoUrl, order;
    let imageUrl: string | undefined, originalImageUrl: string | undefined;

    for await (const part of parts) {
      if (part.type === 'file') {
        if (part.fieldname === 'video') {
          await streamToBuffer(part.file);
          continue;
        }
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'originalImage') {
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
        if (part.fieldname === 'fullDetail') fullDetail = part.value as string;
        if (part.fieldname === 'videoUrl') videoUrl = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    const nextVideoUrl = videoUrl !== undefined ? emptyToNull(videoUrl) : oldData[0].videoUrl;

    // ลบไฟล์เก่าถ้ามีไฟล์ใหม่ (หรือเปลี่ยนจากไฟล์วิดีโอเป็นลิงก์ YouTube)
    const urlsToDelete: string[] = [];
    if (imageUrl && oldData[0].imageUrl) urlsToDelete.push(oldData[0].imageUrl);
    if (originalImageUrl && oldData[0].originalImageUrl) urlsToDelete.push(oldData[0].originalImageUrl);
    if (oldData[0].videoUrl && oldData[0].videoUrl !== nextVideoUrl) {
      urlsToDelete.push(oldData[0].videoUrl);
    }
    if (urlsToDelete.length > 0) deleteFromStorage(urlsToDelete);

    await db.update(honors).set({
      prefix: prefix !== undefined ? prefix : oldData[0].prefix,
      name: name || oldData[0].name,
      awardName: awardName || oldData[0].awardName,
      workName: workName !== undefined ? workName : oldData[0].workName,
      awardDetail: awardDetail !== undefined ? awardDetail : oldData[0].awardDetail,
      fullDetail: fullDetail !== undefined ? emptyHtmlToNull(fullDetail) : oldData[0].fullDetail,
      order: order !== undefined ? order : oldData[0].order,
      imageUrl: imageUrl || oldData[0].imageUrl,
      originalImageUrl: originalImageUrl !== undefined ? (originalImageUrl || oldData[0].originalImageUrl) : oldData[0].originalImageUrl,
      videoUrl: nextVideoUrl,
    }).where(eq(honors.id, parseInt(id)));

    return { success: true };
  });

  // 4. PUT: อัปเดตลำดับ (Reorder)
  app.put('/honor/reorder', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
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

  // 5. DELETE: ลบ + ลบไฟล์เก่า (รูป + วิดีโอที่เป็นไฟล์)
  app.delete('/honor/:id', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const honorId = parseInt(id);

    const target = await db.select().from(honors).where(eq(honors.id, honorId)).limit(1);
    if (target.length > 0) {
      // ลบทั้ง cropped + original + video (ลิงก์ YouTube จะถูกข้ามใน deleteFromStorage)
      await deleteFromStorage([target[0].imageUrl, target[0].originalImageUrl, target[0].videoUrl]);
    }

    await db.delete(honors).where(eq(honors.id, honorId));
    return { success: true };
  });
}

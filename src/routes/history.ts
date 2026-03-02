// src/routes/history.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { councilHistory } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function historyRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล
  app.get('/history', async (req, reply) => {
    return await db.select().from(councilHistory).orderBy(desc(councilHistory.id));
  });

  // 2. POST: สร้างใหม่
  app.post('/history', { preHandler: [verifyToken, requirePermission('manage_history')] }, async (req, reply) => {
    const parts = req.parts();
    let term = '', startYear = '', endYear = '', presidentName = '', secretaryName = '';
    let presidentImage = '', secretaryImage = '';
    let originalPresidentImage = '', originalSecretaryImage = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('history', buffer, part.filename, part.mimetype, part.fieldname);
        if (url) {
          if (part.fieldname === 'presidentImage') presidentImage = url;
          if (part.fieldname === 'secretaryImage') secretaryImage = url;
          if (part.fieldname === 'originalPresidentImage') originalPresidentImage = url;
          if (part.fieldname === 'originalSecretaryImage') originalSecretaryImage = url;
        }
      } else {
        if (part.fieldname === 'term') term = part.value as string;
        if (part.fieldname === 'startYear') startYear = part.value as string;
        if (part.fieldname === 'endYear') endYear = part.value as string;
        if (part.fieldname === 'presidentName') presidentName = part.value as string;
        if (part.fieldname === 'secretaryName') secretaryName = part.value as string;
      }
    }

    await db.insert(councilHistory).values({
      term, startYear, endYear, presidentName, secretaryName, 
      presidentImage, secretaryImage, originalPresidentImage, originalSecretaryImage
    });
    return { success: true };
  });

  // 3. PUT: แก้ไข
  app.put('/history/:id', { preHandler: [verifyToken, requirePermission('manage_history')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    const oldData = await db.select().from(councilHistory).where(eq(councilHistory.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    const updateData: any = { ...oldData[0] };

    // เก็บ URL ภาพใหม่ที่ถูกอัปโหลด
    const newUploadUrls: { [key: string]: string } = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const url = await uploadToStorage('history', buffer, part.filename, part.mimetype, part.fieldname);
        if (url) {
          if (part.fieldname === 'presidentImage') newUploadUrls.presidentImage = url;
          if (part.fieldname === 'secretaryImage') newUploadUrls.secretaryImage = url;
          if (part.fieldname === 'originalPresidentImage') newUploadUrls.originalPresidentImage = url;
          if (part.fieldname === 'originalSecretaryImage') newUploadUrls.originalSecretaryImage = url;
        }
      } else {
        if (part.fieldname === 'term') updateData.term = part.value as string;
        if (part.fieldname === 'startYear') updateData.startYear = part.value as string;
        if (part.fieldname === 'endYear') updateData.endYear = part.value as string;
        if (part.fieldname === 'presidentName') updateData.presidentName = part.value as string;
        if (part.fieldname === 'secretaryName') updateData.secretaryName = part.value as string;
      }
    }

    // ลบรูปภาพเก่าทิ้งแบบ Asynchronous ถ้ามีการอัปโหลดรูปใหม่เข้ามาแทนที่
    const urlsToDelete: string[] = [];

    if (newUploadUrls.presidentImage) {
      if (oldData[0].presidentImage) urlsToDelete.push(oldData[0].presidentImage);
      updateData.presidentImage = newUploadUrls.presidentImage;
    }
    if (newUploadUrls.originalPresidentImage) {
      if (oldData[0].originalPresidentImage && oldData[0].originalPresidentImage !== updateData.presidentImage) {
          urlsToDelete.push(oldData[0].originalPresidentImage);
      }
      updateData.originalPresidentImage = newUploadUrls.originalPresidentImage;
    }

    if (newUploadUrls.secretaryImage) {
      if (oldData[0].secretaryImage) urlsToDelete.push(oldData[0].secretaryImage);
      updateData.secretaryImage = newUploadUrls.secretaryImage;
    }
    if (newUploadUrls.originalSecretaryImage) {
      if (oldData[0].originalSecretaryImage && oldData[0].originalSecretaryImage !== updateData.secretaryImage) {
          urlsToDelete.push(oldData[0].originalSecretaryImage);
      }
      updateData.originalSecretaryImage = newUploadUrls.originalSecretaryImage;
    }

    if (urlsToDelete.length > 0) {
      deleteFromStorage(urlsToDelete).catch(e => console.error("Error deleting old history images:", e));
    }

    await db.update(councilHistory).set({
      term: updateData.term,
      startYear: updateData.startYear,
      endYear: updateData.endYear,
      presidentName: updateData.presidentName,
      secretaryName: updateData.secretaryName,
      presidentImage: updateData.presidentImage,
      originalPresidentImage: updateData.originalPresidentImage,
      secretaryImage: updateData.secretaryImage,
      originalSecretaryImage: updateData.originalSecretaryImage,
    }).where(eq(councilHistory.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE: ลบ
  app.delete('/history/:id', { preHandler: [verifyToken, requirePermission('manage_history')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const memberId = parseInt(id);

    const target = await db.select().from(councilHistory).where(eq(councilHistory.id, memberId)).limit(1);
    
    if (target.length > 0) {
      const urlsToDelete = [
        target[0].presidentImage,
        target[0].originalPresidentImage,
        target[0].secretaryImage,
        target[0].originalSecretaryImage
      ].filter((url): url is string => !!url); // กรองเอาแต่ string ที่มีค่าจริงๆ

      if (urlsToDelete.length > 0) {
         // ลบรูปแบบ async ไม่ให้ตอบกลับช้า
         deleteFromStorage(urlsToDelete).catch(e => console.error("Error deleting history images on delete:", e));
      }
    }

    await db.delete(councilHistory).where(eq(councilHistory.id, memberId));
    return { success: true };
  });
}
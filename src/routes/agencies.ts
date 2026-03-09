// src/routes/agencies.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { agencies } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function agencyRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูลทั้งหมด
  app.get('/agencies', async (req, reply) => {
    return await db.select()
      .from(agencies)
      .orderBy(asc(agencies.category), asc(agencies.order));
  });

  // 2. POST: เพิ่มข้อมูลใหม่
  app.post('/agencies', { preHandler: [verifyToken, requirePermission('manage_agency')] }, async (req, reply) => {
    const parts = req.parts();
    let name = '', title = '', description = '', url = '', category = '', order = 99;
    let thumbnailUrl = '', originalThumbnailUrl = '', logoUrl = '', iconUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'thumbnail') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'thumbnail');
          if (u) thumbnailUrl = u;
        } else if (part.fieldname === 'originalThumbnail') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'originalThumbnail');
          if (u) originalThumbnailUrl = u;
        } else if (part.fieldname === 'logo') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'logo');
          if (u) logoUrl = u;
        } else if (part.fieldname === 'icon') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'icon');
          if (u) iconUrl = u;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'description') description = part.value as string;
        if (part.fieldname === 'url') url = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    await db.insert(agencies).values({
      order,
      name,
      title: title || null,
      description: description || null,
      thumbnailUrl: thumbnailUrl || null,
      originalThumbnailUrl: originalThumbnailUrl || null,
      logoUrl: logoUrl || null,
      iconUrl: iconUrl || null,
      url,
      category,
    });
    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูล
  app.put('/agencies/:id', { preHandler: [verifyToken, requirePermission('manage_agency')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();

    const oldData = await db.select().from(agencies).where(eq(agencies.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    let name, title, description, url, category, order;
    let thumbnailUrl: string | undefined, originalThumbnailUrl: string | undefined;
    let logoUrl: string | undefined, iconUrl: string | undefined;

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'thumbnail') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'thumbnail');
          if (u) thumbnailUrl = u;
        } else if (part.fieldname === 'originalThumbnail') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'originalThumbnail');
          if (u) originalThumbnailUrl = u;
        } else if (part.fieldname === 'logo') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'logo');
          if (u) logoUrl = u;
        } else if (part.fieldname === 'icon') {
          const u = await uploadToStorage('agencies', buffer, part.filename, part.mimetype, 'icon');
          if (u) iconUrl = u;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'description') description = part.value as string;
        if (part.fieldname === 'url') url = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    // ลบรูปเก่าถ้ามีรูปใหม่
    const urlsToDelete: string[] = [];
    if (thumbnailUrl && oldData[0].thumbnailUrl) urlsToDelete.push(oldData[0].thumbnailUrl);
    if (originalThumbnailUrl && oldData[0].originalThumbnailUrl) urlsToDelete.push(oldData[0].originalThumbnailUrl);
    if (logoUrl && oldData[0].logoUrl) urlsToDelete.push(oldData[0].logoUrl);
    if (iconUrl && oldData[0].iconUrl) urlsToDelete.push(oldData[0].iconUrl);
    if (urlsToDelete.length > 0) deleteFromStorage(urlsToDelete);

    await db.update(agencies).set({
      name: name || oldData[0].name,
      title: title !== undefined ? title : oldData[0].title,
      description: description !== undefined ? description : oldData[0].description,
      url: url || oldData[0].url,
      category: category || oldData[0].category,
      order: order !== undefined ? order : oldData[0].order,
      thumbnailUrl: thumbnailUrl || oldData[0].thumbnailUrl,
      originalThumbnailUrl: originalThumbnailUrl !== undefined ? (originalThumbnailUrl || oldData[0].originalThumbnailUrl) : oldData[0].originalThumbnailUrl,
      logoUrl: logoUrl || oldData[0].logoUrl,
      iconUrl: iconUrl || oldData[0].iconUrl,
    }).where(eq(agencies.id, parseInt(id)));

    return { success: true };
  });

  // 4. PUT: อัปเดตลำดับ (Reorder)
  app.put('/agencies/reorder', { preHandler: [verifyToken, requirePermission('manage_agency')] }, async (req, reply) => {
    const items = req.body as { id: number; order: number }[];
    if (!Array.isArray(items)) {
      return reply.status(400).send({ message: 'Invalid format' });
    }

    for (const item of items) {
      await db.update(agencies)
        .set({ order: item.order })
        .where(eq(agencies.id, item.id));
    }

    return { success: true };
  });

  // 5. DELETE: ลบ + ลบรูปทั้งหมดจาก Storage
  app.delete('/agencies/:id', { preHandler: [verifyToken, requirePermission('manage_agency')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const agencyId = parseInt(id);

    const target = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
    if (target.length > 0) {
      await deleteFromStorage([
        target[0].thumbnailUrl,
        target[0].originalThumbnailUrl,
        target[0].logoUrl,
        target[0].iconUrl,
      ]);
    }

    await db.delete(agencies).where(eq(agencies.id, agencyId));
    return { success: true };
  });
}
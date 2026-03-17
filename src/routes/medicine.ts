// src/routes/medicine.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { medicineArticles } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage, getFilePathFromUrl } from '../utils/upload';
import { supabase } from '../utils/supabase';

// Helper: ดึง URL รูปภาพทั้งหมดออกจาก HTML String
function extractImageUrls(htmlContent: string): string[] {
  const urls: string[] = [];
  const regex = /<img[^>]+src="([^">]+)"/g;
  let match;
  while ((match = regex.exec(htmlContent)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

export async function medicineRoutes(app: FastifyInstance) {
  // GET: ดึงบทความความรู้เรื่องยาทั้งหมด (filter ตาม status ได้)
  app.get('/medicine', async (req, reply) => {
    const { status } = req.query as { status?: string };
    const conditions = [];
    if (status) conditions.push(eq(medicineArticles.status, status as any));

    const result = await db
      .select()
      .from(medicineArticles)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(medicineArticles.publishedAt), desc(medicineArticles.createdAt));

    return result;
  });

  // GET: ดึงบทความตาม id
  app.get('/medicine/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db.select().from(medicineArticles).where(eq(medicineArticles.id, parseInt(id))).limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบบทความ' });
    return result[0];
  });

  // POST: Upload Image (สำหรับ Editor)
  app.post('/medicine/upload-image', { preHandler: [verifyToken, requirePermission('manage_news')] }, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.status(400).send({ message: 'No file uploaded' });

      const fileBuffer = await streamToBuffer(data.file);
      const url = await uploadToStorage('medicine-content', fileBuffer, data.filename, data.mimetype);

      if (!url) return reply.status(500).send({ message: 'Upload failed' });
      return { url };
    } catch (err) {
      console.error('Upload Error:', err);
      return reply.status(500).send({ message: 'Internal Server Error' });
    }
  });

  // POST: สร้างบทความความรู้เรื่องยา
  app.post('/medicine', { preHandler: [verifyToken, requirePermission('manage_news')] }, async (req, reply) => {
    const { title, content, excerpt, status, publishedAt, thumbnailUrl } = req.body as any;
    if (!title || !content) {
      return reply.status(400).send({ message: 'Title and content are required' });
    }

    const result = await db
      .insert(medicineArticles)
      .values({
        title,
        content,
        excerpt,
        thumbnailUrl,
        status: status || 'draft',
        publishedAt: publishedAt ? new Date(publishedAt) : status === 'published' ? new Date() : null,
      })
      .returning();

    return { success: true, data: result[0] };
  });

  // PUT: แก้ไขบทความ
  app.put('/medicine/:id', { preHandler: [verifyToken, requirePermission('manage_news')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { title, content, excerpt, status, publishedAt, thumbnailUrl } = req.body as any;
      const existing = await db
        .select()
        .from(medicineArticles)
        .where(eq(medicineArticles.id, parseInt(id)))
        .limit(1);

      if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

      // ลบรูปที่ถูกลบออกจาก content และ excerpt
      const oldImages = [
        ...extractImageUrls(existing[0].content || ''),
        ...extractImageUrls(existing[0].excerpt || ''),
      ];
      const newImages = [
        ...extractImageUrls(content || ''),
        ...extractImageUrls(excerpt || ''),
      ];
      const deletedImages = oldImages.filter((url) => !newImages.includes(url));

      // ลบรูป Thumbnail เก่าถ้ามีการเปลี่ยนรูป
      if (existing[0].thumbnailUrl && existing[0].thumbnailUrl !== thumbnailUrl) {
        deletedImages.push(existing[0].thumbnailUrl);
      }

      if (deletedImages.length > 0) {
        const filePaths = deletedImages
          .map((url) => getFilePathFromUrl(url))
          .filter((p): p is string => !!p);
        if (filePaths.length > 0) {
          await supabase.storage.from('uploads').remove(filePaths);
          await supabase.storage.from('medicine').remove(filePaths);
        }
      }

      const updateData: any = {
        title,
        content,
        excerpt,
        status,
        thumbnailUrl,
        updatedAt: new Date(),
        publishedAt: publishedAt ? new Date(publishedAt) : existing[0].publishedAt,
      };

      if (status === 'published' && !updateData.publishedAt) {
        updateData.publishedAt = new Date();
      }

      const result = await db
        .update(medicineArticles)
        .set(updateData)
        .where(eq(medicineArticles.id, parseInt(id)))
        .returning();

      return { success: true, data: result[0] };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to update medicine article' });
    }
  });

  // DELETE: ลบบทความ + ลบรูปจาก Storage
  app.delete('/medicine/:id', { preHandler: [verifyToken, requirePermission('manage_news')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await db
        .select()
        .from(medicineArticles)
        .where(eq(medicineArticles.id, parseInt(id)))
        .limit(1);

      if (existing.length > 0) {
        const images = [
          ...extractImageUrls(existing[0].content || ''),
          ...extractImageUrls(existing[0].excerpt || ''),
        ];
        if (existing[0].thumbnailUrl) {
          images.push(existing[0].thumbnailUrl);
        }

        if (images.length > 0) {
          const filePaths = images
            .map((url) => getFilePathFromUrl(url))
            .filter((p): p is string => !!p);
          if (filePaths.length > 0) {
            await supabase.storage.from('uploads').remove(filePaths);
            await supabase.storage.from('medicine').remove(filePaths);
          }
        }
      }

      await db.delete(medicineArticles).where(eq(medicineArticles.id, parseInt(id)));
      return { success: true, message: 'ลบบทความความรู้เรื่องยาเรียบร้อย' };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to delete medicine article' });
    }
  });
}


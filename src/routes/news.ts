// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { verifyToken, requireRole } from '../utils/authGuard';
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

export async function newsRoutes(app: FastifyInstance) {

  // GET: ดึงข่าวทั้งหมด (filter ได้)
  app.get('/news', async (req, reply) => {
    const { category, status } = req.query as { category?: string; status?: string };
    const conditions = [];
    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));
    const result = await db.select().from(news)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(news.createdAt));
    return result;
  });

  // GET: ดึงข่าวตาม id
  app.get('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });
    return result[0];
  });

  // POST: Upload Image (สำหรับ Editor)
  app.post('/news/upload-image', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.status(400).send({ message: 'No file uploaded' });

      const fileBuffer = await streamToBuffer(data.file);
      const url = await uploadToStorage('news-content', fileBuffer, data.filename, data.mimetype);

      if (!url) return reply.status(500).send({ message: 'Upload failed' });
      return { url };
    } catch (err) {
      console.error('Upload Error:', err);
      return reply.status(500).send({ message: 'Internal Server Error' });
    }
  });

  // POST: สร้างข่าว (JSON Body)
  app.post('/news', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { title, content, category, status, order, publishedAt } = req.body as any;

    if (!title || !content) {
      return reply.status(400).send({ message: 'Title and content are required' });
    }

    const result = await db.insert(news).values({
      title,
      content,
      category: category || 'news',
      status: status || 'draft',
      order: parseInt(order || '0'),
      publishedAt: publishedAt ? new Date(publishedAt) : (status === 'published' ? new Date() : null),
    }).returning();

    return { success: true, data: result[0] };
  });

  // PUT: แก้ไขข่าว (JSON Body)
  app.put('/news/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { title, content, category, status, order, publishedAt } = req.body as any;

      const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
      if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

      // ลบรูปที่ถูกลบออกจาก content
      const oldImages = extractImageUrls(existing[0].content || '');
      const newImages = extractImageUrls(content || '');
      const deletedImages = oldImages.filter(url => !newImages.includes(url));
      if (deletedImages.length > 0) {
        const filePaths = deletedImages
          .map(url => getFilePathFromUrl(url))
          .filter((p): p is string => !!p);
        if (filePaths.length > 0) {
          await supabase.storage.from('uploads').remove(filePaths);
        }
      }

      const updateData: any = {
        title, content, category, status,
        order: parseInt(order || '0'),
        updatedAt: new Date(),
        publishedAt: publishedAt ? new Date(publishedAt) : existing[0].publishedAt,
      };

      if (status === 'published' && !updateData.publishedAt) {
        updateData.publishedAt = new Date();
      }

      const result = await db.update(news)
        .set(updateData)
        .where(eq(news.id, parseInt(id)))
        .returning();
      return { success: true, data: result[0] };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to update news' });
    }
  });

  // DELETE: ลบข่าว + ลบรูปจาก Storage
  app.delete('/news/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);

      if (existing.length > 0) {
        const images = extractImageUrls(existing[0].content || '');
        if (images.length > 0) {
          const filePaths = images
            .map(url => getFilePathFromUrl(url))
            .filter((p): p is string => !!p);
          if (filePaths.length > 0) {
            await supabase.storage.from('uploads').remove(filePaths);
          }
        }
      }

      await db.delete(news).where(eq(news.id, parseInt(id)));
      return { success: true, message: 'ลบข่าวเรียบร้อย' };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to delete news' });
    }
  });
}
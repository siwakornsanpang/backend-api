// src/routes/publicProject.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { publicProjectArticles } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, getFilePathFromUrl } from '../utils/upload';
import { supabase } from '../utils/supabase';

function extractImageUrls(htmlContent: string): string[] {
  const urls: string[] = [];
  const regex = /<img[^>]+src="([^">]+)"/g;
  let match;
  while ((match = regex.exec(htmlContent)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

export async function publicProjectRoutes(app: FastifyInstance) {
  // GET: ดึงรายการโครงการของประชาชน
  app.get('/public-project', async (req, reply) => {
    const { status } = req.query as { status?: string };
    const conditions = [];
    if (status) conditions.push(eq(publicProjectArticles.status, status as any));

    const result = await db
      .select()
      .from(publicProjectArticles)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(publicProjectArticles.publishedAt), desc(publicProjectArticles.createdAt));

    return result;
  });

  // GET: ดึงตาม id
  app.get('/public-project/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db
      .select()
      .from(publicProjectArticles)
      .where(eq(publicProjectArticles.id, parseInt(id)))
      .limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบบทความ' });
    return result[0];
  });

  // POST: Upload Image (สำหรับ Editor/Thumbnail)
  app.post(
    '/public-project/upload-image',
    { preHandler: [verifyToken, requirePermission('manage_news')] },
    async (req, reply) => {
      try {
        const data = await req.file();
        if (!data) return reply.status(400).send({ message: 'No file uploaded' });

        const fileBuffer = await streamToBuffer(data.file);
        const url = await uploadToStorage('public-project-content', fileBuffer, data.filename, data.mimetype);

        if (!url) return reply.status(500).send({ message: 'Upload failed' });
        return { url };
      } catch (err) {
        console.error('Upload Error:', err);
        return reply.status(500).send({ message: 'Internal Server Error' });
      }
    }
  );

  // POST: สร้าง
  app.post('/public-project', { preHandler: [verifyToken, requirePermission('manage_news')] }, async (req, reply) => {
    const { title, content, excerpt, status, publishedAt, thumbnailUrl, category } = req.body as any;
    if (!title || !content) {
      return reply.status(400).send({ message: 'Title and content are required' });
    }

    const result = await db
      .insert(publicProjectArticles)
      .values({
        title,
        content,
        excerpt,
        thumbnailUrl,
        category: category || 'public_project',
        status: status || 'draft',
        publishedAt: publishedAt ? new Date(publishedAt) : status === 'published' ? new Date() : null,
      })
      .returning();

    return { success: true, data: result[0] };
  });

  // PUT: แก้ไข
  app.put('/public-project/:id', { preHandler: [verifyToken, requirePermission('manage_news')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { title, content, excerpt, status, publishedAt, thumbnailUrl, category } = req.body as any;

      const existing = await db
        .select()
        .from(publicProjectArticles)
        .where(eq(publicProjectArticles.id, parseInt(id)))
        .limit(1);
      if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

      const oldImages = [
        ...extractImageUrls(existing[0].content || ''),
        ...extractImageUrls(existing[0].excerpt || ''),
      ];
      const newImages = [
        ...extractImageUrls(content || ''),
        ...extractImageUrls(excerpt || ''),
      ];
      const deletedImages = oldImages.filter((url) => !newImages.includes(url));

      if (existing[0].thumbnailUrl && existing[0].thumbnailUrl !== thumbnailUrl) {
        deletedImages.push(existing[0].thumbnailUrl);
      }

      if (deletedImages.length > 0) {
        const filePaths = deletedImages
          .map((url) => getFilePathFromUrl(url))
          .filter((p): p is string => !!p);
        if (filePaths.length > 0) {
          await supabase.storage.from('uploads').remove(filePaths);
          await supabase.storage.from('public-project').remove(filePaths);
        }
      }

      const updateData: any = {
        title,
        content,
        excerpt,
        status,
        category: category || existing[0].category || 'public_project',
        thumbnailUrl,
        updatedAt: new Date(),
        publishedAt: publishedAt ? new Date(publishedAt) : existing[0].publishedAt,
      };

      if (status === 'published' && !updateData.publishedAt) {
        updateData.publishedAt = new Date();
      }

      const result = await db
        .update(publicProjectArticles)
        .set(updateData)
        .where(eq(publicProjectArticles.id, parseInt(id)))
        .returning();

      return { success: true, data: result[0] };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to update public project' });
    }
  });

  // DELETE: ลบ + ลบรูปจาก Storage
  app.delete('/public-project/:id', { preHandler: [verifyToken, requirePermission('manage_news')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await db
        .select()
        .from(publicProjectArticles)
        .where(eq(publicProjectArticles.id, parseInt(id)))
        .limit(1);

      if (existing.length > 0) {
        const images = [
          ...extractImageUrls(existing[0].content || ''),
          ...extractImageUrls(existing[0].excerpt || ''),
        ];
        if (existing[0].thumbnailUrl) images.push(existing[0].thumbnailUrl);

        if (images.length > 0) {
          const filePaths = images
            .map((url) => getFilePathFromUrl(url))
            .filter((p): p is string => !!p);
          if (filePaths.length > 0) {
            await supabase.storage.from('uploads').remove(filePaths);
            await supabase.storage.from('public-project').remove(filePaths);
          }
        }
      }

      await db.delete(publicProjectArticles).where(eq(publicProjectArticles.id, parseInt(id)));
      return { success: true, message: 'ลบโครงการของประชาชนเรียบร้อย' };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to delete public project' });
    }
  });
}


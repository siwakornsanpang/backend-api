// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

// ✅ 1. เพิ่ม Helper Function นี้ไว้บนสุด (นอก export function)
// ฟังก์ชันนี้จะช่วยแปลง Stream เป็น Buffer โดยไม่ทำให้ล่มง่ายๆ
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function newsRoutes(app: FastifyInstance) {

  // GET ... (เหมือนเดิม)
  app.get('/news', async (req, reply) => {
    // ... code เดิม ...
    const { category, status } = req.query as { category?: string; status?: string };
    const conditions = [];
    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));
    const result = await db.select().from(news)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(news.createdAt));
    return result;
  });

  app.get('/news/:id', async (req, reply) => {
    // ... code เดิม ...
    const { id } = req.params as { id: string };
    const result = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });
    return result[0];
  });

  // -------------------------------------------------------
  // ✅ 2. API Upload Image (แก้ไขใหม่ รับมือ Stream)
  // -------------------------------------------------------
  app.post('/news/upload-image', async (req, reply) => {
    try {
      // เมื่อเอา attachFieldsToBody ออก เราต้องใช้ req.file()
      const data = await req.file();

      if (!data) {
        return reply.status(400).send({ message: 'No file uploaded' });
      }

      const ext = path.extname(data.filename);
      const filename = `news-content/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;

      // ✅ แปลง Stream เป็น Buffer ด้วยฟังก์ชันที่เราสร้างเอง
      const fileBuffer = await streamToBuffer(data.file);

      // Upload ขึ้น Supabase
      const { error } = await supabase.storage
        .from('uploads')
        .upload(filename, fileBuffer, {
          contentType: data.mimetype,
          upsert: true
        });

      if (error) {
        console.error('Supabase Error:', error);
        return reply.status(500).send({ message: 'Upload failed' });
      }

      const { data: publicData } = supabase.storage
        .from('uploads')
        .getPublicUrl(filename);

      return { url: publicData.publicUrl };

    } catch (err) {
      console.error('Upload Error:', err);
      return reply.status(500).send({ message: 'Internal Server Error' });
    }
  });

  // -------------------------------------------------------
  // ✅ 3. POST: สร้างข่าว (JSON Body ปกติ)
  // -------------------------------------------------------
  app.post('/news', async (req, reply) => {
    // พอเอา attachFieldsToBody ออก Fastify จะกลับมาอ่าน JSON ใน req.body ได้ปกติโดยไม่ต้องทำอะไรเพิ่ม
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
      // images: [],
      publishedAt: publishedAt ? new Date(publishedAt) : (status === 'published' ? new Date() : null),
    }).returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // ✅ 4. PUT: แก้ไขข่าว (รับ JSON)
  // -------------------------------------------------------
  app.put('/news/:id', async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      // รับ JSON Body
      const { title, content, category, status, order, publishedAt } = req.body as any;

      // เช็คว่ามีข่าวนี้จริงไหม
      const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
      if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

      const updateData: any = {
        title,
        content,
        category,
        status,
        order: parseInt(order || '0'),
        updatedAt: new Date(),
        publishedAt: publishedAt ? new Date(publishedAt) : existing[0].publishedAt
      };

      // อัปเดตเวลา publish ถ้าเพิ่งเปลี่ยนสถานะเป็น published
      if (status === 'published' && !updateData.publishedAt) {
        updateData.publishedAt = new Date();
      }

      // สั่ง Update
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

  // DELETE: ลบข่าว
  app.delete('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(news).where(eq(news.id, parseInt(id)));
    return { success: true, message: 'ลบข่าวเรียบร้อย' };
  });
}
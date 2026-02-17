// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, desc } from 'drizzle-orm'; // เอา and ออกถ้าไม่ได้ใช้
import { supabase } from '../utils/supabase';
import path from 'path';
import { pipeline } from 'stream/promises'; // ใช้ตัวช่วยจัดการ stream

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
    const { title, content, category, status, order } = req.body as any;

    if (!title || !content) {
      return reply.status(400).send({ message: 'Title and content are required' });
    }

    const result = await db.insert(news).values({
      title,
      content,
      category: category || 'news',
      status: status || 'draft',
      order: parseInt(order || '0'),
      images: [],
      publishedAt: status === 'published' ? new Date() : null,
    }).returning();

    return { success: true, data: result[0] };
  });

  // PUT ... (แก้เหมือน POST คือใช้ req.body ได้เลย)
  app.put('/news/:id', async (req, reply) => {
      // ... code เดิมที่ใช้ req.body ...
      const { id } = req.params as { id: string };
      const body = req.body as any;
      // ... logic เดิม ...
      // แค่เช็คว่า return ถูกต้อง
      return { success: true, message: 'Updated' }; // ตัวอย่าง
  });

  // DELETE: ลบข่าว
  app.delete('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(news).where(eq(news.id, parseInt(id)));
    return { success: true, message: 'ลบข่าวเรียบร้อย' };
  });
}
// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

export async function newsRoutes(app: FastifyInstance) {

  // ... (GET /news และ GET /news/:id คงเดิม) ...
  app.get('/news', async (req, reply) => { /* ...code เดิม... */ });
  app.get('/news/:id', async (req, reply) => { /* ...code เดิม... */ });

  // -------------------------------------------------------
  // ✅ 1. เพิ่ม API สำหรับอัปโหลดรูปจาก Editor โดยเฉพาะ
  // -------------------------------------------------------
  app.post('/news/upload-image', async (req, reply) => {
    // ❌ แบบเดิม (ใช้ไม่ได้เมื่อ attachFieldsToBody: true)
    // const data = await req.file(); 

    // ✅ แบบใหม่: ดึงจาก req.body
    const body = req.body as any;
    const data = body.file; // ชื่อ 'file' ต้องตรงกับที่ Frontend ส่งมาใน formData

    if (!data) {
      return reply.status(400).send({ message: 'No file uploaded' });
    }

    const ext = path.extname(data.filename);
    const filename = `news-content/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
    
    // แปลงไฟล์เป็น Buffer
    const fileBuffer = await data.toBuffer();

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

    // Get Public URL
    const { data: publicData } = supabase.storage
      .from('uploads')
      .getPublicUrl(filename);

    return { url: publicData.publicUrl };
  });

  // -------------------------------------------------------
  // ✅ 2. ปรับ POST: สร้างข่าว (รับเป็น JSON ปกติแล้ว)
  // -------------------------------------------------------
  app.post('/news', async (req, reply) => {
    // ไม่ต้องใช้ req.parts() หรือ req.body.value แล้ว เพราะเราจะส่ง JSON
    const { title, content, category, status, order } = req.body as any;

    if (!title || !content) {
      return reply.status(400).send({ message: 'Title and content are required' });
    }

    const result = await db.insert(news).values({
      title,
      content, // HTML ที่มี <img src="..."> อยู่ข้างในแล้ว
      category,
      status,
      order,
      images: [], // ไม่ได้ใช้ field นี้แบบแยกแล้ว (หรือจะใส่ URL รูปแรกที่ parse จาก content ก็ได้)
      publishedAt: status === 'published' ? new Date() : null,
    }).returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // ✅ 3. ปรับ PUT: แก้ไขข่าว (รับเป็น JSON ปกติ)
  // -------------------------------------------------------
  app.put('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { title, content, category, status, order } = req.body as any;

    const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

    const updateData: any = { 
      title, 
      content, 
      category, 
      status, 
      order, 
      updatedAt: new Date() 
    };

    if (status === 'published' && !existing[0].publishedAt) {
      updateData.publishedAt = new Date();
    }

    const result = await db.update(news)
      .set(updateData)
      .where(eq(news.id, parseInt(id)))
      .returning();

    return { success: true, data: result[0] };
  });

  // DELETE: ลบข่าว
  app.delete('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(news).where(eq(news.id, parseInt(id)));
    return { success: true, message: 'ลบข่าวเรียบร้อย' };
  });
}
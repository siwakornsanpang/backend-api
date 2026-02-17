// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

export async function newsRoutes(app: FastifyInstance) {

  // GET: ดึงข่าวทั้งหมด
  app.get('/news', async (req, reply) => {
    const { category, status } = req.query as { category?: string; status?: string };
    const conditions = [];
    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));

    const result = await db
      .select()
      .from(news)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(news.createdAt));

    return result;
  });

  // GET: ดึงข่าว 1 อัน
  app.get('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });
    return result[0];
  });

  // -------------------------------------------------------
  // ✅ 3. POST: สร้างข่าวใหม่ (แบบใช้ req.body)
  // -------------------------------------------------------
  app.post('/news', async (req, reply) => {
    const body = req.body as any; // ข้อมูลมาที่นี่แล้ว เพราะ attachFieldsToBody: true

    // 1. ดึงค่า Text (ค่าจะอยู่ใน .value)
    const title = body.title?.value;
    const content = body.content?.value;
    const category = body.category?.value || 'news';
    const status = body.status?.value || 'draft';
    const order = parseInt(body.order?.value || '0');

    if (!title || !content) {
      return reply.status(400).send({ message: 'ต้องระบุ title และ content' });
    }

    // 2. จัดการรูปภาพ (Upload Supabase)
    const uploadedImages: string[] = [];
    
    // files อาจเป็น Array (หลายไฟล์) หรือ Object (ไฟล์เดียว) หรือ undefined
    // เราแปลงให้เป็น Array เสมอเพื่อวนลูปง่ายๆ
    const fileParts = body.files ? (Array.isArray(body.files) ? body.files : [body.files]) : [];

    for (const part of fileParts) {
      if (!part.filename) continue; // ข้ามถ้าไม่ใช่ไฟล์

      const ext = path.extname(part.filename);
      const filename = `news/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
      const fileBuffer = await part.toBuffer(); // แปลงเป็น Buffer

      const { error } = await supabase.storage
        .from('uploads')
        .upload(filename, fileBuffer, {
          contentType: part.mimetype,
          upsert: true
        });

      if (!error) {
        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        uploadedImages.push(data.publicUrl);
      }
    }

    // 3. บันทึกลง Database
    const result = await db.insert(news).values({
      title,
      content,
      category: category as any,
      status: status as any,
      order,
      images: uploadedImages, 
      publishedAt: status === 'published' ? new Date() : null,
    }).returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // ✅ 4. PUT: แก้ไขข่าว (แบบใช้ req.body)
  // -------------------------------------------------------
  app.put('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });

    const body = req.body as any;
    const updateData: any = { updatedAt: new Date() };

    // 1. Update Text Fields
    if (body.title) updateData.title = body.title.value;
    if (body.content) updateData.content = body.content.value;
    if (body.category) updateData.category = body.category.value;
    if (body.order) updateData.order = parseInt(body.order.value);
    
    if (body.status) {
      updateData.status = body.status.value;
      if (updateData.status === 'published' && !existing[0].publishedAt) {
        updateData.publishedAt = new Date();
      }
    }

    // 2. จัดการรูปภาพ
    const newUploadedImages: string[] = [];
    const fileParts = body.files ? (Array.isArray(body.files) ? body.files : [body.files]) : [];

    for (const part of fileParts) {
      if (!part.filename) continue;
      
      const ext = path.extname(part.filename);
      const filename = `news/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
      const fileBuffer = await part.toBuffer();

      const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, {
          contentType: part.mimetype,
          upsert: true
      });

      if (!error) {
          const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
          newUploadedImages.push(data.publicUrl);
      }
    }

    // 3. จัดการรูปเดิม (JSON String -> Array)
    let existingImagesFromClient: string[] = [];
    if (body.existingImages) {
        try {
            // body.existingImages.value จะเป็น string json เช่น "['url1', 'url2']"
            existingImagesFromClient = JSON.parse(body.existingImages.value);
        } catch (e) {
            existingImagesFromClient = [];
        }
    } else {
        // ถ้าไม่ได้ส่งมา (อาจเกิดจากไม่ได้แก้รูป) หรือส่งผิด ให้ใช้รูปเดิมที่มีใน DB (Optional)
        // แต่ตาม Logic Frontend ของคุณ ถ้าลบรูป มันจะส่ง Array ที่เหลือมา ดังนั้นถ้าไม่ส่งมาแปลว่าลบหมด หรือ Error
        // ในที่นี้ขอ assume ว่า Frontend ส่งมาเสมอถ้ามีรูปเหลือ
    }

    // รวมรูป
    updateData.images = [...existingImagesFromClient, ...newUploadedImages];

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
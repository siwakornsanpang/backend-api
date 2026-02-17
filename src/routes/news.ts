// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, asc, desc, and } from 'drizzle-orm';
import { supabase } from '../utils/supabase'; // เรียกใช้ supabase
import path from 'path';

// Helper: แปลงไฟล์เป็น Buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function newsRoutes(app: FastifyInstance) {

  // -------------------------------------------------------
  // 1. GET: ดึงข่าวทั้งหมด (เหมือนเดิม)
  // -------------------------------------------------------
  app.get('/news', async (req, reply) => {
    const { category, status } = req.query as { category?: string; status?: string };
    
    const conditions = [];
    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));

    const result = await db
      .select()
      .from(news)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(news.createdAt)); // แนะนำเรียงตามเวลาที่สร้างล่าสุด

    return result;
  });

  // -------------------------------------------------------
  // 2. GET: ดึงข่าว 1 อัน (เหมือนเดิม)
  // -------------------------------------------------------
  app.get('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });
    return result[0];
  });

  // -------------------------------------------------------
  // 3. POST: สร้างข่าวใหม่ (แบบ Multipart Upload)
  // -------------------------------------------------------
  app.post('/news', async (req, reply) => {
    const parts = req.parts();
    
    // ตัวแปรสำหรับเก็บข้อมูล
    let title = '';
    let content = '';
    let category = 'news';
    let status = 'draft';
    let order = 0;
    const uploadedImages: string[] = []; // เก็บ URL ของรูปที่อัปโหลดใหม่

    // วนลูปรับข้อมูล (ทั้งไฟล์และ text)
    for await (const part of parts) {
      if (part.type === 'file') {
        // --- ส่วนจัดการไฟล์ (Upload ขึ้น Supabase) ---
        const ext = path.extname(part.filename);
        const filename = `news/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        const { error } = await supabase.storage
          .from('uploads') // ชื่อ Bucket
          .upload(filename, fileBuffer, {
            contentType: part.mimetype,
            upsert: true
          });

        if (error) {
           console.error('Upload error:', error);
           continue; // ถ้าอัปโหลดรูปนี้ไม่ผ่าน ให้ข้ามไป
        }

        const { data: publicData } = supabase.storage
          .from('uploads')
          .getPublicUrl(filename);
          
        uploadedImages.push(publicData.publicUrl);

      } else {
        // --- ส่วนจัดการ Text Field ---
        // part.value อาจเป็น object หรือ string ขึ้นอยู่กับการส่ง
        const value = part.value as string;
        if (part.fieldname === 'title') title = value;
        if (part.fieldname === 'content') content = value;
        if (part.fieldname === 'category') category = value;
        if (part.fieldname === 'status') status = value;
        if (part.fieldname === 'order') order = parseInt(value) || 0;
      }
    }

    if (!title || !content) {
      return reply.status(400).send({ message: 'ต้องระบุ title และ content' });
    }

    // บันทึกลงฐานข้อมูล
    const result = await db.insert(news).values({
      title,
      content,
      category: category as any,
      status: status as any,
      order,
      images: uploadedImages, // ใส่ URL รูปที่ได้จาก Supabase
      publishedAt: status === 'published' ? new Date() : null,
    }).returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // 4. PUT: แก้ไขข่าว (แบบ Multipart Upload)
  // -------------------------------------------------------
  app.put('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    
    // ตรวจสอบว่ามีข่าวเดิมอยู่ไหม
    const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });

    const parts = req.parts();
    
    // เตรียมตัวแปร Update (ใช้ค่าเดิมเป็น default)
    const updateData: any = { updatedAt: new Date() };
    const newUploadedImages: string[] = [];
    let existingImagesFromClient: string[] = []; // รับ URL รูปเดิมที่ User ไม่ได้ลบ

    for await (const part of parts) {
      if (part.type === 'file') {
        // --- Upload ไฟล์ใหม่ ---
        const ext = path.extname(part.filename);
        const filename = `news/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, {
            contentType: part.mimetype,
            upsert: true
        });

        if (!error) {
            const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
            newUploadedImages.push(data.publicUrl);
        }

      } else {
        // --- รับ Text Field ---
        const value = part.value as string;
        if (part.fieldname === 'title') updateData.title = value;
        if (part.fieldname === 'content') updateData.content = value;
        if (part.fieldname === 'category') updateData.category = value;
        if (part.fieldname === 'status') {
            updateData.status = value;
            if (value === 'published' && !existing[0].publishedAt) {
                updateData.publishedAt = new Date();
            }
        }
        if (part.fieldname === 'order') updateData.order = parseInt(value);
        
        // **สำคัญ**: รับรายการรูปเก่าที่ Client ส่งมา (ส่งมาเป็น JSON String Array)
        // Frontend ต้องส่ง field ชื่อ 'existingImages' เป็น JSON.stringify(['url1', 'url2'])
        if (part.fieldname === 'existingImages') {
            try {
                existingImagesFromClient = JSON.parse(value);
            } catch (e) {
                existingImagesFromClient = [];
            }
        }
      }
    }

    // รวมรูปเก่าที่ User เลือกเก็บไว้ + รูปใหม่ที่เพิ่งอัปโหลด
    // ถ้า User ไม่ได้ส่ง existingImages มาเลย (เช่นการส่ง form ผิด) อาจต้องระวังการลบรูปทิ้งทั้งหมด
    // แต่ใน logic นี้เราจะถือว่า: รูปสุดท้าย = (รูปเก่าที่ส่งมา) + (รูปใหม่)
    updateData.images = [...existingImagesFromClient, ...newUploadedImages];

    const result = await db.update(news)
      .set(updateData)
      .where(eq(news.id, parseInt(id)))
      .returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // 5. DELETE: ลบข่าว (เหมือนเดิม เพิ่มลบรูปจาก Supabase ได้ถ้าต้องการ)
  // -------------------------------------------------------
  app.delete('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });

    // (Option) ลบรูปออกจาก Supabase ด้วยก็ได้ถ้าต้องการ Clean up
    // const images = existing[0].images || [];
    // ... logic delete from supabase ...

    await db.delete(news).where(eq(news.id, parseInt(id)));
    return { success: true, message: 'ลบข่าวเรียบร้อย' };
  });
}
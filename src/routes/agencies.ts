// src/routes/agencies.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { agencies } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import { randomUUID } from 'crypto';
import path from 'path';
import { verifyToken, requireRole } from '../utils/authGuard';

// Helper: แปลง Stream เป็น Buffer สำหรับอัปโหลด
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) { chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export async function agencyRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล (รองรับการกรองตาม category)
  app.get('/agencies', { preHandler: [verifyToken] }, async (req, reply) => {
    const { category } = req.query as { category?: string };
    
    let query = db.select().from(agencies);
    
    if (category) {
      // @ts-ignore
      query = query.where(eq(agencies.category, category));
    }
    
    // เรียงตาม order (น้อยไปมาก)
    return await query.orderBy(asc(agencies.order));
  });

  // 2. POST: เพิ่มข้อมูลใหม่
  app.post('/agencies', { preHandler: [verifyToken, requireRole('admin', 'editor')] }, async (req, reply) => {
    const parts = req.parts();
    let data: any = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        // จัดการอัปโหลดรูป
        const ext = path.extname(part.filename);
        const filename = `agencies/${Date.now()}_${randomUUID()}${ext}`;
        const buffer = await streamToBuffer(part.file);
        
        const { error } = await supabase.storage.from('uploads').upload(filename, buffer, { contentType: part.mimetype });
        if (error) console.error("Upload Error:", error);

        const { data: publicData } = supabase.storage.from('uploads').getPublicUrl(filename);
        data.imageUrl = publicData.publicUrl;
      } else {
        // จัดการข้อมูล Text
        data[part.fieldname] = part.value;
      }
    }

    // แปลงค่า order เป็นตัวเลข
    if (data.order) data.order = parseInt(data.order);

    await db.insert(agencies).values({
      name: data.name,
      description: data.description,
      url: data.url,
      category: data.category,
      order: data.order || 0,
      imageUrl: data.imageUrl
    });

    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูล (ส่วนที่คุณติดปัญหา) ✅
  app.put('/agencies/:id', { preHandler: [verifyToken, requireRole('admin', 'editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    let updateData: any = {};

    for await (const part of parts) {
       if (part.type === 'file') {
          // ถ้ามีการอัปรูปใหม่ -> อัปโหลดและเอา URL ใหม่ไปใส่ updateData
          const ext = path.extname(part.filename);
          const filename = `agencies/${Date.now()}_${randomUUID()}${ext}`;
          const buffer = await streamToBuffer(part.file);
          
          await supabase.storage.from('uploads').upload(filename, buffer, { contentType: part.mimetype });
          const { data: publicData } = supabase.storage.from('uploads').getPublicUrl(filename);
          
          // ใส่ URL ใหม่ลงใน field 'imageUrl' (ใน DB ชื่อ image_url จะถูก map อัตโนมัติถ้ายึดตาม schema)
          // แต่เพื่อให้ชัวร์ ให้เช็คชื่อ field ใน schema.ts ของคุณ
          // ถ้าใน schema ใช้ camelCase (imageUrl) ให้ใช้ imageUrl
          // ถ้าใน schema ใช้ snake_case (image_url) และ Drizzle map ให้ ก็ใช้ imageUrl ได้เลย
          updateData.imageUrl = publicData.publicUrl;
       } else {
          // อัปเดตข้อมูล Text เฉพาะที่ส่งมา
          updateData[part.fieldname] = part.value;
       }
    }

    // แปลง order เป็นตัวเลข (ถ้ามีการส่งมาแก้ไข)
    if (updateData.order) updateData.order = parseInt(updateData.order);

    // ทำการ Update ลง Database
    await db.update(agencies)
      .set(updateData)
      .where(eq(agencies.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE: ลบข้อมูล
  app.delete('/agencies/:id', { preHandler: [verifyToken, requireRole('admin', 'editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(agencies).where(eq(agencies.id, parseInt(id)));
    return { success: true };
  });
}
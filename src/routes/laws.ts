// src/routes/laws.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { laws } from '../db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

// Helper: แปลงไฟล์เป็น Buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function lawRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูลตามหมวดหมู่ (เรียงตามลำดับ Order)
  app.get('/laws/:category', async (req, reply) => {
    const { category } = req.params as { category: string };
    const result = await db.select()
      .from(laws)
      .where(eq(laws.category, category))
      .orderBy(asc(laws.order)); // เรียงตามเลขลำดับน้อยไปมาก
    return result;
  });

  // 2. POST: เพิ่มกฎหมายใหม่ (พร้อมอัปโหลด PDF)
  app.post('/laws', async (req, reply) => {
    const parts = req.parts();
    
    let title = '';
    let category = '';
    let announcedAt = '';
    let order = 0;
    let pdfUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        // จัดการไฟล์ PDF
        const ext = path.extname(part.filename);
        const filename = `laws/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        const { error } = await supabase.storage
          .from('uploads')
          .upload(filename, fileBuffer, {
            contentType: part.mimetype,
            upsert: true
          });

        if (error) throw new Error('Upload failed: ' + error.message);

        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        pdfUrl = data.publicUrl;

      } else {
        // จัดการข้อมูล Text
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
      }
    }

    // บันทึกลง Database
    await db.insert(laws).values({
      title,
      category,
      announcedAt, // ส่งมาเป็น string 'YYYY-MM-DD'
      order,
      pdfUrl
    });

    return { success: true, message: 'บันทึกข้อมูลเรียบร้อย' };
  });

  // 3. DELETE: ลบข้อมูล
  app.delete('/laws/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    
    // (Optional) ถ้าจะให้โปรจริงๆ ควรไป query หา pdfUrl มาลบใน Supabase ด้วย
    // แต่เพื่อความไวตอนนี้ ลบแค่ใน DB ก่อนก็ได้ครับ ไฟล์ค้างใน Cloud ไม่เป็นไร พื้นที่เหลือเฟือ
    
    await db.delete(laws).where(eq(laws.id, parseInt(id)));
    return { success: true, message: 'ลบข้อมูลเรียบร้อย' };
  });
}
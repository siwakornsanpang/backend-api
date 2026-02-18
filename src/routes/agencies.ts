// src/routes/agencies.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { agencies } from '../db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { supabase } from '../utils/supabase'; // ใช้ Supabase upload เหมือนเดิม
import { randomUUID } from 'crypto';
import path from 'path';

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) { chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export async function agencyRoutes(app: FastifyInstance) {

  // GET: ดึงข้อมูล (รองรับ ?category=xxx)
  app.get('/agencies', async (req, reply) => {
    const { category } = req.query as { category?: string };
    
    let query = db.select().from(agencies);
    
    if (category) {
      // @ts-ignore
      query = query.where(eq(agencies.category, category));
    }
    
    // เรียงตาม order น้อยไปมาก
    const result = await query.orderBy(asc(agencies.order));
    return result;
  });

  // POST: เพิ่มข้อมูล (พร้อมรูป)
  app.post('/agencies', async (req, reply) => {
    const parts = req.parts();
    
    let name = '';
    let description = '';
    let url = '';
    let category = '';
    let order = 0;
    let imageUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `agencies/${Date.now()}_${randomUUID()}${ext}`;
        const buffer = await streamToBuffer(part.file);
        
        await supabase.storage.from('uploads').upload(filename, buffer, { contentType: part.mimetype });
        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        imageUrl = data.publicUrl;
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'description') description = part.value as string;
        if (part.fieldname === 'url') url = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
      }
    }

    await db.insert(agencies).values({
      name, description, url, category, order, imageUrl
    });

    return { success: true };
  });

  // PUT: แก้ไขข้อมูล
  app.put('/agencies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    // ... (Logic รับค่าเหมือน POST) ...
    // เขียน Logic Update โดยเช็คว่าถ้า imageUrl ว่าง ไม่ต้อง update field นั้น
    // (ขอละไว้สั้นๆ เพื่อความกระชับ ถ้าต้องการตัวเต็มบอกได้ครับ)
    
    // *ตัวอย่างแบบย่อ*
    let updateData: any = {};
    for await (const part of parts) {
       if (part.type === 'file') {
          // Upload logic...
          updateData.imageUrl = '...new url...';
       } else {
          // Field mapping...
          updateData[part.fieldname] = part.value;
       }
    }
    await db.update(agencies).set(updateData).where(eq(agencies.id, parseInt(id)));
    return { success: true };
  });

  // DELETE: ลบ
  app.delete('/agencies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(agencies).where(eq(agencies.id, parseInt(id)));
    return { success: true };
  });
}
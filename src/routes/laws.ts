// src/routes/laws.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { laws } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function lawRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล (ดึงมาหมด เดี๋ยวให้ Frontend ไปโชว์สถานะเอาเอง)
  app.get('/laws/:category', async (req, reply) => {
    const { category } = req.params as { category: string };
    return await db.select().from(laws)
      .where(eq(laws.category, category))
      .orderBy(asc(laws.order)); 
  });

  // 2. POST: เพิ่มข้อมูลใหม่ (+ รับค่า status)
  app.post('/laws', async (req, reply) => {
    const parts = req.parts();
    // 🔥 เพิ่มตัวแปร status (default 'online')
    let title = '', category = '', announcedAt = '', order = 0, pdfUrl = '', status = 'online';

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `laws/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });
        if (error) throw new Error('Upload failed: ' + error.message);
        
        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        pdfUrl = data.publicUrl;
      } else {
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
        // 🔥 รับค่า status
        if (part.fieldname === 'status') status = part.value as string;
      }
    }

    // 🔥 บันทึก status ลง DB
    await db.insert(laws).values({ title, category, announcedAt, order, pdfUrl, status });
    return { success: true, message: 'บันทึกข้อมูลเรียบร้อย' };
  });

  // 3. PUT: แก้ไขข้อมูล (+ อัปเดต status)
  app.put('/laws/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    // 🔥 เพิ่มตัวแปร status
    let title = '', announcedAt = '', order = 0, pdfUrl = '', status = '', hasNewFile = false;

    const existing = await db.select().from(laws).where(eq(laws.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'ไม่พบข้อมูล' });

    for await (const part of parts) {
      if (part.type === 'file') {
        hasNewFile = true;
        const ext = path.extname(part.filename);
        const filename = `laws/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);
        
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });
        if (error) throw new Error('Upload failed: ' + error.message);

        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        pdfUrl = data.publicUrl;
      } else {
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
        // 🔥 รับค่า status
        if (part.fieldname === 'status') status = part.value as string;
      }
    }

    await db.update(laws).set({
      title: title || existing[0].title,
      announcedAt: announcedAt || null,
      order: order,
      // 🔥 ถ้าส่ง status มาให้อัปเดต ถ้าไม่ส่งให้ใช้ค่าเดิม
      status: status || existing[0].status,
      ...(hasNewFile ? { pdfUrl } : {}),
    }).where(eq(laws.id, parseInt(id)));

    return { success: true, message: 'แก้ไขข้อมูลเรียบร้อย' };
  });

  // 4. DELETE (เหมือนเดิม)
  app.delete('/laws/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(laws).where(eq(laws.id, parseInt(id)));
    return { success: true, message: 'ลบข้อมูลเรียบร้อย' };
  });
}
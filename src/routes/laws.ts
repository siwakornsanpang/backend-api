// src/routes/laws.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { laws } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
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

  // 1. GET: ดึงข้อมูลตามหมวดหมู่
  app.get('/laws/:category', async (req, reply) => {
    const { category } = req.params as { category: string };
    const result = await db.select()
      .from(laws)
      .where(eq(laws.category, category))
      .orderBy(asc(laws.order)); 
    return result;
  });

  // 2. POST: เพิ่มข้อมูลใหม่
  app.post('/laws', async (req, reply) => {
    const parts = req.parts();
    let title = '', category = '', announcedAt = '', order = 0, pdfUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `laws/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        const { error } = await supabase.storage
          .from('uploads')
          .upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });

        if (error) throw new Error('Upload failed: ' + error.message);
        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        pdfUrl = data.publicUrl;
      } else {
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
      }
    }

    await db.insert(laws).values({ title, category, announcedAt, order, pdfUrl });
    return { success: true, message: 'บันทึกข้อมูลเรียบร้อย' };
  });

  // 3. PUT: แก้ไขข้อมูล (อัปเดตใหม่)
  app.put('/laws/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    let title = '', announcedAt = '', order = 0, pdfUrl = '', hasNewFile = false;

    // หาข้อมูลเก่าก่อน
    const existing = await db.select().from(laws).where(eq(laws.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'ไม่พบข้อมูล' });

    for await (const part of parts) {
      if (part.type === 'file') {
        hasNewFile = true;
        const ext = path.extname(part.filename);
        const filename = `laws/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        const { error } = await supabase.storage
          .from('uploads')
          .upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });

        if (error) throw new Error('Upload failed: ' + error.message);
        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        pdfUrl = data.publicUrl;
      } else {
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
      }
    }

    await db.update(laws).set({
      title: title || existing[0].title,
      announcedAt: announcedAt || null,
      order: order,
      ...(hasNewFile ? { pdfUrl } : {}), // เปลี่ยน URL แค่ตอนมีไฟล์ใหม่
    }).where(eq(laws.id, parseInt(id)));

    return { success: true, message: 'แก้ไขข้อมูลเรียบร้อย' };
  });

  // 4. DELETE: ลบข้อมูล (ชัดเจน ไม่ซ้ำ)
  app.delete('/laws/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(laws).where(eq(laws.id, parseInt(id)));
    return { success: true, message: 'ลบข้อมูลเรียบร้อย' };
  });
}
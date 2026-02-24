// src/routes/laws.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { laws } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';
import { verifyToken, requireRole } from '../utils/authGuard';

// Helper: แปลงไฟล์เป็น Buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function lawRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล
  app.get('/laws/:category', async (req, reply) => {
    const { category } = req.params as { category: string };
    return await db.select().from(laws)
      .where(eq(laws.category, category))
      .orderBy(asc(laws.order)); 
  });

  // 2. POST: เพิ่มข้อมูลใหม่
  app.post('/laws', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const parts = req.parts();
    let title = '', category = '', announcedAt = '', order = 0, pdfUrl = '', status = 'online';

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `laws/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });
        if (!error) {
             const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
             pdfUrl = data.publicUrl;
        }
      } else {
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'category') category = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string) || 0;
        if (part.fieldname === 'status') status = part.value as string;
      }
    }

    await db.insert(laws).values({ title, category, announcedAt, order, pdfUrl, status });
    return { success: true };
  });

  // 3. PUT: แก้ไข (แก้ Bug ข้อมูลหายตรงนี้!)
  app.put('/laws/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    // 🔥 แก้ไข 1: ไม่ใส่ค่า Default (ให้เป็น undefined) เพื่อจะได้รู้ว่า Client ส่งมาหรือไม่
    let title, announcedAt, order, status, pdfUrl;
    let hasNewFile = false;

    // ดึงค่าเดิมจาก DB มาเตรียมไว้
    const existing = await db.select().from(laws).where(eq(laws.id, parseInt(id))).limit(1);
    if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

    for await (const part of parts) {
      if (part.type === 'file') {
        hasNewFile = true;
        const ext = path.extname(part.filename);
        const filename = `laws/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });
        if (!error) {
            const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
            pdfUrl = data.publicUrl;
        }
      } else {
        // 🔥 แก้ไข 2: รับค่าตามที่ส่งมาจริง
        if (part.fieldname === 'title') title = part.value as string;
        if (part.fieldname === 'announcedAt') announcedAt = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'status') status = part.value as string;
      }
    }

    // 🔥 แก้ไข 3: Logic การบันทึก (สำคัญมาก!)
    // ใช้ Syntax: (ค่าใหม่ !== undefined) ? ค่าใหม่ : ค่าเดิม
    await db.update(laws).set({
      title: title !== undefined ? title : existing[0].title,
      
      // วันที่: ถ้าส่งมาว่างๆ ('') ให้เป็น null, ถ้าไม่ส่งมา (undefined) ให้ใช้ค่าเดิม
      announcedAt: announcedAt !== undefined ? (announcedAt === '' ? null : announcedAt) : existing[0].announcedAt,
      
      // ลำดับ: ถ้าไม่ได้ส่งมา ให้ใช้ค่าเดิม
      order: order !== undefined ? (isNaN(order) ? 0 : order) : existing[0].order,
      
      status: status !== undefined ? status : existing[0].status,
      
      ...(hasNewFile ? { pdfUrl } : {}),
    }).where(eq(laws.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE
  app.delete('/laws/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(laws).where(eq(laws.id, parseInt(id)));
    return { success: true };
  });
}
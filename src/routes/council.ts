// src/routes/council.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { councilMembers } from '../db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

// Helper function: แปลง Stream เป็น Buffer สำหรับอัปโหลด
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function councilRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล "ทั้งหมด" (ไม่ต้องแยก type แล้ว)
  // เรียงตาม ประเภท ก่อน แล้วค่อยเรียงตาม ลำดับ (order)
  app.get('/council', async (req, reply) => {
    return await db.select()
      .from(councilMembers)
      .orderBy(asc(councilMembers.type), asc(councilMembers.order));
  });

  // 2. POST: สร้างข้อมูลใหม่ (Create)
  app.post('/council', async (req, reply) => {
    const parts = req.parts();
    let name = '', position = '', type = 'elected', order = 99, imageUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `council/${Date.now()}_${part.filename}`;
        const fileBuffer = await streamToBuffer(part.file);
        
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });
        if (!error) {
           const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
           imageUrl = data.publicUrl;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'position') position = part.value as string;
        if (part.fieldname === 'type') type = part.value as string; // รับค่า 'elected' หรือ 'appointed'
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    await db.insert(councilMembers).values({ name, position, type, order, imageUrl });
    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูลตาม ID (Update)
  app.put('/council/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    let name, position, type, order, imageUrl;
    
    // ดึงค่าเดิมมาก่อน
    const oldData = await db.select().from(councilMembers).where(eq(councilMembers.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `council/${Date.now()}_${part.filename}`;
        const fileBuffer = await streamToBuffer(part.file);
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });
        if (!error) {
           const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
           imageUrl = data.publicUrl;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'position') position = part.value as string;
        if (part.fieldname === 'type') type = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    await db.update(councilMembers).set({
      name: name || oldData[0].name,
      position: position || oldData[0].position,
      type: type || oldData[0].type,
      order: order !== undefined ? order : oldData[0].order,
      imageUrl: imageUrl || oldData[0].imageUrl
    }).where(eq(councilMembers.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE: ลบตาม ID
  app.delete('/council/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(councilMembers).where(eq(councilMembers.id, parseInt(id)));
    return { success: true };
  });
}
// src/routes/council.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { councilMembers } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function councilRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูลตามประเภท (elected / appointed)
  app.get('/council/:type', async (req, reply) => {
    const { type } = req.params as { type: string };
    // ดึงเฉพาะข้อมูลของประเภทนั้นๆ
    return await db.select().from(councilMembers).where(eq(councilMembers.type, type));
  });

  // 2. POST: บันทึกข้อมูล (Save Slot)
  // เราใช้ POST ตัวเดียวเลย เพราะเราจะเช็คว่า Slot นี้มีคนนั่งหรือยัง
  app.post('/council/save', async (req, reply) => {
    const parts = req.parts();
    
    let name = '', position = '', type = '', order = 0, imageUrl = '';
    let hasNewFile = false;

    // รับค่าจาก Form
    for await (const part of parts) {
      if (part.type === 'file') {
        hasNewFile = true;
        const ext = path.extname(part.filename);
        const filename = `council/${type}/${order}_${Date.now()}${ext}`; // ตั้งชื่อไฟล์ตามลำดับเลย จะได้ไม่รก
        const fileBuffer = await streamToBuffer(part.file);
        
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });
        if (error) throw new Error(error.message);
        
        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        imageUrl = data.publicUrl;
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'position') position = part.value as string;
        if (part.fieldname === 'type') type = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    // เช็คว่ามีคนใน Slot นี้หรือยัง (Type นี้ + Order นี้)
    const existing = await db.select().from(councilMembers)
      .where(and(eq(councilMembers.type, type), eq(councilMembers.order, order)))
      .limit(1);

    if (existing.length > 0) {
      // มีแล้ว -> Update
      await db.update(councilMembers).set({
        name,
        position,
        ...(hasNewFile ? { imageUrl } : {}), // ถ้าไม่มีรูปใหม่ ใช้รูปเดิม
      }).where(eq(councilMembers.id, existing[0].id));
    } else {
      // ยังไม่มี -> Insert
      await db.insert(councilMembers).values({
        name,
        position,
        type,
        order,
        imageUrl
      });
    }

    return { success: true };
  });

  // 3. POST: ล้างข้อมูลใน Slot (Reset)
  app.post('/council/clear', async (req, reply) => {
     const { type, order } = req.body as { type: string, order: number };
     
     // ลบข้อมูลออกจาก DB ตาม Type และ Order
     await db.delete(councilMembers)
       .where(and(eq(councilMembers.type, type), eq(councilMembers.order, order)));
       
     return { success: true };
  });
}
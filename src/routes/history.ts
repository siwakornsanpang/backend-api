// src/routes/history.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { councilHistory } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';
import { verifyToken, requireRole } from '../utils/authGuard';

// Helper functions (เหมือนเดิม)
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sanitizeFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext);
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_'); 
  return `${safeName}${ext}`;
}

function getFilePathFromUrl(url: string): string | null {
    if (!url) return null;
    const marker = '/uploads/';
    const parts = url.split(marker);
    if (parts.length < 2) return null;
    return parts[1];
}

export async function historyRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล (เรียงตาม id หรือ วาระ ก็ได้)
  app.get('/history', { preHandler: [verifyToken] }, async (req, reply) => {
    // เรียง id ล่าสุดขึ้นก่อน (หรือจะเรียงตาม term ก็ได้)
    return await db.select().from(councilHistory).orderBy(desc(councilHistory.id));
  });

  // 2. POST: สร้างใหม่
  app.post('/history', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const parts = req.parts();
    
    let term = '', years = '';
    let presidentName = '', secretaryName = '';
    let presidentImage = '', secretaryImage = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        // 🔥 เช็ค fieldname ว่าเป็นรูปของใคร
        const buffer = await streamToBuffer(part.file);
        const filename = `history/${Date.now()}_${part.fieldname}_${sanitizeFilename(part.filename)}`;
        
        const { error } = await supabase.storage.from('uploads').upload(filename, buffer, { contentType: part.mimetype, upsert: true });
        if (!error) {
            const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
            
            if (part.fieldname === 'presidentImage') presidentImage = data.publicUrl;
            if (part.fieldname === 'secretaryImage') secretaryImage = data.publicUrl;
        }
      } else {
        // รับค่า Text
        if (part.fieldname === 'term') term = part.value as string;
        if (part.fieldname === 'years') years = part.value as string;
        if (part.fieldname === 'presidentName') presidentName = part.value as string;
        if (part.fieldname === 'secretaryName') secretaryName = part.value as string;
      }
    }

    await db.insert(councilHistory).values({ 
        term, years, presidentName, secretaryName, presidentImage, secretaryImage 
    });
    return { success: true };
  });

  // 3. PUT: แก้ไข
  app.put('/history/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    // ดึงค่าเดิมมาก่อน
    const oldData = await db.select().from(councilHistory).where(eq(councilHistory.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    let updateData: any = { ...oldData[0] }; // เริ่มต้นด้วยค่าเดิม

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        const filename = `history/${Date.now()}_${part.fieldname}_${sanitizeFilename(part.filename)}`;
        const { error } = await supabase.storage.from('uploads').upload(filename, buffer, { contentType: part.mimetype, upsert: true });
        
        if (!error) {
            const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
            // อัปเดตเฉพาะรูปที่ส่งมาใหม่
            if (part.fieldname === 'presidentImage') updateData.presidentImage = data.publicUrl;
            if (part.fieldname === 'secretaryImage') updateData.secretaryImage = data.publicUrl;
        }
      } else {
        // อัปเดต text (ถ้ามีการส่งมา)
        if (part.fieldname === 'term') updateData.term = part.value as string;
        if (part.fieldname === 'years') updateData.years = part.value as string;
        if (part.fieldname === 'presidentName') updateData.presidentName = part.value as string;
        if (part.fieldname === 'secretaryName') updateData.secretaryName = part.value as string;
      }
    }

    // ตัด field ที่ไม่ควร update ออก (เช่น id, createdAt) ถ้าจำเป็น
    // แต่ drizzle handle ให้
    await db.update(councilHistory).set({
        term: updateData.term,
        years: updateData.years,
        presidentName: updateData.presidentName,
        secretaryName: updateData.secretaryName,
        presidentImage: updateData.presidentImage,
        secretaryImage: updateData.secretaryImage
    }).where(eq(councilHistory.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE: ลบ
  app.delete('/history/:id', { preHandler: [verifyToken, requireRole('admin', 'editor', 'web_editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const memberId = parseInt(id);

    const target = await db.select().from(councilHistory).where(eq(councilHistory.id, memberId)).limit(1);
    if (target.length > 0) {
        const data = target[0];
        // ลบรูปทั้ง 2 (ถ้ามี)
        const filesToDelete = [];
        if (data.presidentImage) {
            const pPath = getFilePathFromUrl(data.presidentImage);
            if(pPath) filesToDelete.push(pPath);
        }
        if (data.secretaryImage) {
            const sPath = getFilePathFromUrl(data.secretaryImage);
            if(sPath) filesToDelete.push(sPath);
        }

        if (filesToDelete.length > 0) {
            await supabase.storage.from('uploads').remove(filesToDelete);
        }
    }

    await db.delete(councilHistory).where(eq(councilHistory.id, memberId));
    return { success: true };
  });
}
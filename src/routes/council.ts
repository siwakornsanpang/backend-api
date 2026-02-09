// src/routes/council.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { councilMembers } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

// Helper: แปลง Stream เป็น Buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Helper: ล้างชื่อไฟล์ให้ปลอดภัย (เปลี่ยนภาษาไทย/เว้นวรรค เป็น _)
function sanitizeFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext);
  // แทนที่ตัวอักษรที่ไม่ใช่ a-z, 0-9 ด้วย _
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_'); 
  return `${safeName}${ext}`;
}


function getFilePathFromUrl(url: string): string | null {
    if (!url) return null;
    const marker = '/uploads/'; // ชื่อ Bucket ของคุณคือ 'uploads'
    const parts = url.split(marker);
    if (parts.length < 2) return null;
    return parts[1]; // ส่วนที่อยู่หลัง /uploads/
}

export async function councilRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข้อมูล
  app.get('/council', async (req, reply) => {
    return await db.select()
      .from(councilMembers)
      .orderBy(asc(councilMembers.type), asc(councilMembers.order));
  });

  // 2. POST: สร้างข้อมูลใหม่
  app.post('/council', async (req, reply) => {
    const parts = req.parts();
    let name = '', position = '', type = 'elected', order = 99, imageUrl = '';

    console.log("--- Starting POST Upload ---");

    for await (const part of parts) {
      if (part.type === 'file') {
        try {
          const fileBuffer = await streamToBuffer(part.file);
          const safeName = sanitizeFilename(part.filename); // ล้างชื่อไฟล์
          const filename = `council/${Date.now()}_${safeName}`;
          
          console.log(`Uploading file: ${filename}, Size: ${fileBuffer.length}`);

          // Upload ขึ้น Supabase
          const { data, error } = await supabase.storage
            .from('uploads')
            .upload(filename, fileBuffer, { 
                contentType: part.mimetype, 
                upsert: true 
            });

          if (error) {
            console.error("❌ Supabase Upload Error:", error.message);
          } else {
            console.log("✅ Upload Success:", data);
            // ดึง Public URL
            const { data: urlData } = supabase.storage
                .from('uploads')
                .getPublicUrl(filename);
            
            imageUrl = urlData.publicUrl;
            console.log("🔗 Image URL:", imageUrl);
          }
        } catch (err) {
            console.error("❌ Stream/Buffer Error:", err);
        }
      } else {
        // รับค่า Field อื่นๆ
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'position') position = part.value as string;
        if (part.fieldname === 'type') type = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
      }
    }

    // บันทึกลง Database
    await db.insert(councilMembers).values({ name, position, type, order, imageUrl });
    return { success: true };
  });

  // 3. PUT: แก้ไขข้อมูล
  app.put('/council/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    let name, position, type, order, imageUrl;
    
    console.log(`--- Starting PUT Update (ID: ${id}) ---`);

    const oldData = await db.select().from(councilMembers).where(eq(councilMembers.id, parseInt(id))).limit(1);
    if (!oldData.length) return reply.status(404).send({ message: 'Not found' });

    for await (const part of parts) {
      if (part.type === 'file') {
        try {
            const fileBuffer = await streamToBuffer(part.file);
            const safeName = sanitizeFilename(part.filename);
            const filename = `council/${Date.now()}_${safeName}`;

            console.log(`Uploading new file: ${filename}`);

            const { error } = await supabase.storage
                .from('uploads')
                .upload(filename, fileBuffer, { contentType: part.mimetype, upsert: true });

            if (error) {
                console.error("❌ Supabase Upload Error:", error.message);
            } else {
                const { data: urlData } = supabase.storage
                    .from('uploads')
                    .getPublicUrl(filename);
                imageUrl = urlData.publicUrl;
                console.log("🔗 New Image URL:", imageUrl);
            }
        } catch (err) {
            console.error("❌ Stream/Buffer Error:", err);
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
      imageUrl: imageUrl || oldData[0].imageUrl // ถ้าไม่มีรูปใหม่ ให้ใช้รูปเดิม
    }).where(eq(councilMembers.id, parseInt(id)));

    return { success: true };
  });

  // 4. DELETE: ลบ
app.delete('/council/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const memberId = parseInt(id);

    // 1. ค้นหาข้อมูลเดิมก่อน เพื่อเอารูปภาพ (imageUrl)
    const target = await db.select()
        .from(councilMembers)
        .where(eq(councilMembers.id, memberId))
        .limit(1);

    if (target.length > 0) {
        const member = target[0];

        // 2. ถ้ามีรูปภาพ ให้ลบออกจาก Supabase Storage
        if (member.imageUrl) {
            const filePath = getFilePathFromUrl(member.imageUrl);
            if (filePath) {
                console.log(`Deleting file from Storage: ${filePath}`);
                const { error } = await supabase.storage
                    .from('uploads') // Bucket ชื่อ uploads
                    .remove([filePath]);
                
                if (error) {
                    console.error("❌ Failed to delete image:", error.message);
                } else {
                    console.log("✅ Image deleted successfully");
                }
            }
        }
    }

    // 3. ลบข้อมูลใน Database ตามปกติ
    await db.delete(councilMembers).where(eq(councilMembers.id, memberId));
    return { success: true };
  });
}
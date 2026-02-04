// src/routes/home.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { homeContent } from '../db/schema';
import { eq } from 'drizzle-orm';
import { supabase } from '../utils/supabase'; // 👈 เรียกใช้ตัวที่เราสร้างตะกี้
import path from 'path';

// Helper: แปลงไฟล์เป็น Buffer (เอาไว้ใช้เฉพาะในไฟล์นี้)
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function homeRoutes(app: FastifyInstance) {
  
  // GET: ดึงข้อมูลหน้าแรก
  app.get('/home-content', async () => {
    const content = await db.select().from(homeContent).limit(1);
    if (content.length === 0) return { welcomeMessage: "", bannerUrl: "" };
    return content[0];
  });

  // POST: อัปโหลดและบันทึก
  app.post('/home-content', async (req, reply) => {
    const parts = req.parts();
    
    let welcomeMessage = '';
    let bannerUrl = '';
    let hasNewImage = false;

    // 1. รับไฟล์ & อัปขึ้น Supabase
    for await (const part of parts) {
      if (part.type === 'file') {
        hasNewImage = true;
        const ext = path.extname(part.filename);
        const filename = `banners/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        
        const fileBuffer = await streamToBuffer(part.file);
        
        const { error } = await supabase.storage
          .from('uploads')
          .upload(filename, fileBuffer, {
            contentType: part.mimetype,
            upsert: true
          });

        if (error) throw new Error('Upload failed: ' + error.message);

        const { data: publicData } = supabase.storage
          .from('uploads')
          .getPublicUrl(filename);
          
        bannerUrl = publicData.publicUrl;
      } else {
        if (part.fieldname === 'welcomeMessage') {
          welcomeMessage = part.value as string;
        }
      }
    }

    // 2. ลบรูปเก่า & บันทึก DB
    const existing = await db.select().from(homeContent).limit(1);
    
    if (existing.length > 0) {
      // Logic ลบรูปเก่า
      if (hasNewImage && existing[0].bannerUrl) {
        try {
          const oldUrl = existing[0].bannerUrl;
          const pathToRemove = oldUrl.split('/uploads/').pop(); 
          if (pathToRemove) {
            await supabase.storage.from('uploads').remove([pathToRemove]);
            console.log('✅ ลบรูปเก่าแล้ว:', pathToRemove);
          }
        } catch (err) {
          console.error("ลบรูปเก่าพลาด:", err);
        }
      }

      await db.update(homeContent).set({
        welcomeMessage: welcomeMessage || existing[0].welcomeMessage,
        ...(hasNewImage ? { bannerUrl } : {}),
        updatedAt: new Date()
      }).where(eq(homeContent.id, existing[0].id));
      
    } else {
      await db.insert(homeContent).values({
        welcomeMessage: welcomeMessage,
        bannerUrl: bannerUrl
      });
    }

    return { success: true, message: 'บันทึกสำเร็จ (Modular Version)', url: bannerUrl };
  });
}
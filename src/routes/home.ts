// src/routes/home.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { homeContent } from '../db/schema';
import { eq } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function homeRoutes(app: FastifyInstance) {
  
  // GET: ดึงข้อมูล
  app.get('/home-content', async () => {
    const content = await db.select().from(homeContent).limit(1);
    if (content.length === 0) {
      return { 
        banners: [], 
        headerText: "", subHeaderText: "", bodyText: "",
        popupImageUrl: "", showPopup: false 
      };
    }
    return content[0];
  });

  // POST: บันทึกข้อมูล (รองรับ Multi-upload)
  app.post('/home-content', async (req, reply) => {
    const parts = req.parts();
    
    // ตัวแปรเก็บค่า
    let headerText = '';
    let subHeaderText = '';
    let bodyText = '';
    
    let showPopup = false;
    let existingBanners: string[] = []; // เก็บ URL รูปเก่าที่ user เลือกเก็บไว้
    let newBannerUrls: string[] = [];   // เก็บ URL รูปใหม่ที่เพิ่งอัป
    let popupUrl = '';
    let hasNewPopup = false;

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `home/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`; // สร้าง Folder home ให้เป็นระเบียบ
        const fileBuffer = await streamToBuffer(part.file);

        // Upload ไป Supabase
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, {
           contentType: part.mimetype, upsert: true 
        });
        if (error) console.error('Upload Error:', error);

        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        
        // แยกแยะว่ารูปนี้คือ Banner หรือ Popup
        if (part.fieldname === 'popupImage') {
          popupUrl = data.publicUrl;
          hasNewPopup = true;
        } else if (part.fieldname === 'bannerImages') {
          newBannerUrls.push(data.publicUrl);
        }

      } else {
        // Handle Text Fields
        if (part.fieldname === 'headerText') headerText = part.value as string;
        if (part.fieldname === 'subHeaderText') subHeaderText = part.value as string;
        if (part.fieldname === 'bodyText') bodyText = part.value as string;
        if (part.fieldname === 'showPopup') showPopup = part.value === 'true';
        if (part.fieldname === 'existingBanners') {
            // รับค่า JSON string ของรูปเก่าที่ยังไม่ถูกลบ
            try {
                existingBanners = JSON.parse(part.value as string);
            } catch (e) { existingBanners = [] }
        }
      }
    }

    // รวมรูปเก่า + รูปใหม่ เข้าด้วยกัน
    const finalBanners = [...existingBanners, ...newBannerUrls];

    // Logic Update Database
    const existing = await db.select().from(homeContent).limit(1);
    
    if (existing.length > 0) {
      // TODO: ถ้าขยัน อาจจะเพิ่ม Logic ไปลบรูปเก่าใน Supabase ที่ไม่อยู่ใน finalBanners แล้ว
      
      await db.update(homeContent).set({
        banners: finalBanners,
        headerText,
        subHeaderText,
        bodyText,
        showPopup,
        ...(hasNewPopup ? { popupImageUrl: popupUrl } : {}), // อัปเดตเฉพาะถ้ามีรูปใหม่
        updatedAt: new Date()
      }).where(eq(homeContent.id, existing[0].id));
      
    } else {
      await db.insert(homeContent).values({
        banners: finalBanners,
        headerText, subHeaderText, bodyText,
        showPopup,
        popupImageUrl: popupUrl
      });
    }

    return { success: true };
  });
}
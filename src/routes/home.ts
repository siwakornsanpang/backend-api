// src/routes/home.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { homeContent } from '../db/schema';
import { eq } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';
import { randomUUID } from 'crypto';

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
        banners: [], // ส่งกลับเป็น Array ว่าง
        headerText: "", subHeaderText: "", bodyText: "",
        popupImageUrl: "", showPopup: false 
      };
    }
    return content[0];
  });

  // POST: บันทึกข้อมูล
  app.post('/home-content', async (req, reply) => {
    const parts = req.parts();
    
    // ตัวแปรเก็บค่า
    let headerText = '';
    let subHeaderText = '';
    let bodyText = '';
    let showPopup = false;
    
    // เก็บ Banner เป็น Object แบบใหม่
    let currentBanners: any[] = []; 
    let newBannerUrls: string[] = [];
    let popupUrl = '';
    let hasNewPopup = false;

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `home/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        // Upload
        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, {
           contentType: part.mimetype, upsert: true 
        });

        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        
        if (part.fieldname === 'popupImage') {
          popupUrl = data.publicUrl;
          hasNewPopup = true;
        } else if (part.fieldname === 'bannerImages') {
          newBannerUrls.push(data.publicUrl);
        }

      } else {
        // Handle Fields
        if (part.fieldname === 'headerText') headerText = part.value as string;
        if (part.fieldname === 'subHeaderText') subHeaderText = part.value as string;
        if (part.fieldname === 'bodyText') bodyText = part.value as string;
        if (part.fieldname === 'showPopup') showPopup = part.value === 'true';
        
        if (part.fieldname === 'currentBanners') {
            // รับ JSON ของ Banner ปัจจุบันที่ Client ส่งมา (รวมการเรียงลำดับ/สถานะ active)
            try {
                currentBanners = JSON.parse(part.value as string);
            } catch (e) { currentBanners = [] }
        }
      }
    }

    // 1. เอา Banner เก่าที่ User จัดการแล้วมาตั้งต้น
    let finalBanners = [...currentBanners];

    // 2. เอารูปใหม่ที่เพิ่งอัปโหลด มาต่อท้าย (สร้างเป็น Object)
    const newBannerObjects = newBannerUrls.map((url, index) => ({
        id: randomUUID(),
        url: url,
        active: true, // รูปใหม่ให้เปิดใช้งานเลย
        order: finalBanners.length + index + 1
    }));

    finalBanners = [...finalBanners, ...newBannerObjects];

    // Logic Update Database
    const existing = await db.select().from(homeContent).limit(1);
    
    const updateData = {
        banners: finalBanners,
        headerText, subHeaderText, bodyText,
        showPopup,
        updatedAt: new Date()
    };

    if (hasNewPopup) {
        (updateData as any).popupImageUrl = popupUrl;
    }

    if (existing.length > 0) {
      await db.update(homeContent).set(updateData).where(eq(homeContent.id, existing[0].id));
    } else {
      await db.insert(homeContent).values({
        ...updateData,
        popupImageUrl: popupUrl
      } as any);
    }

    return { success: true };
  });
}
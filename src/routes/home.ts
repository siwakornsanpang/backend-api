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
  
  // GET: (เหมือนเดิม)
  app.get('/home-content', async () => {
    const content = await db.select().from(homeContent).limit(1);
    if (content.length === 0) {
      return { banners: [], headerText: "", subHeaderText: "", bodyText: "", popupImageUrl: "", showPopup: false };
    }
    return content[0];
  });

  // POST: แก้ไขใหม่ รองรับการเรียงลำดับผสมกัน
  app.post('/home-content', async (req, reply) => {
    const parts = req.parts();
    
    let headerText = '';
    let subHeaderText = '';
    let bodyText = '';
    let showPopup = false;
    
    let bannerData: any[] = []; // JSON ที่บอกลำดับและสถานะ
    let uploadedBannerUrls: string[] = []; // เก็บ URL ของรูปที่เพิ่งอัปโหลด
    
    let popupUrl = '';
    let hasNewPopup = false;

    // 1. วนลูปรับไฟล์และข้อมูล
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
        } else if (part.fieldname === 'bannerFiles') {
          // เก็บ URL รูปใหม่เข้า Array รอไว้ก่อน
          uploadedBannerUrls.push(data.publicUrl);
        }

      } else {
        // Handle Fields
        if (part.fieldname === 'headerText') headerText = part.value as string;
        if (part.fieldname === 'subHeaderText') subHeaderText = part.value as string;
        if (part.fieldname === 'bodyText') bodyText = part.value as string;
        if (part.fieldname === 'showPopup') showPopup = part.value === 'true';
        
        if (part.fieldname === 'bannerData') {
            try {
                bannerData = JSON.parse(part.value as string);
            } catch (e) { bannerData = [] }
        }
      }
    }

    // 2. ประกอบร่าง Banner (Merge รูปเก่า + รูปใหม่ตามลำดับ)
    // bannerData จะส่งมาเป็น list ที่เรียงแล้ว โดยตัวที่เป็นรูปใหม่จะมี flag "isNewFile": true
    let newFileIndex = 0;
    
    const finalBanners = bannerData.map((item, index) => {
        let url = item.url;
        
        // ถ้าเป็นรายการที่ระบุว่าเป็นไฟล์ใหม่ ให้ไปหยิบ URL จากที่เพิ่งอัปโหลดมาใส่
        if (item.isNewFile) {
            url = uploadedBannerUrls[newFileIndex] || url; // กันเหนียว
            newFileIndex++;
        }

        return {
            id: item.id || randomUUID(),
            url: url,
            active: item.active,
            order: index + 1 // รันเลขลำดับใหม่ตามที่ส่งมา
        };
    });

    // 3. Update Database
    const existing = await db.select().from(homeContent).limit(1);
    
    const updateData = {
        banners: finalBanners,
        headerText, subHeaderText, bodyText,
        showPopup,
        updatedAt: new Date()
    };

    if (hasNewPopup) { (updateData as any).popupImageUrl = popupUrl; }

    if (existing.length > 0) {
      await db.update(homeContent).set(updateData).where(eq(homeContent.id, existing[0].id));
    } else {
      await db.insert(homeContent).values({ ...updateData, popupImageUrl: popupUrl } as any);
    }

    return { success: true };
  });
}
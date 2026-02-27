// src/routes/home.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { homeContent } from '../db/schema';
import { eq } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';
import { randomUUID } from 'crypto';
import { verifyToken, requirePermission } from '../utils/authGuard';

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
    if (content.length === 0) {
      return { banners: [], popupImageUrl: "", showPopup: false };
    }
    return content[0];
  });

  // POST: บันทึกข้อมูลหน้าแรก
  app.post('/home-content', { preHandler: [verifyToken, requirePermission('manage_home')] }, async (req, reply) => {
    const parts = req.parts();
    
    let showPopup = false;
    
    let bannerData: any[] = [];
    let uploadedBannerUrls: string[] = [];
    
    let popupUrl = '';
    let hasNewPopup = false;

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `home/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, {
           contentType: part.mimetype, upsert: true 
        });

        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        
        if (part.fieldname === 'popupImage') {
          popupUrl = data.publicUrl;
          hasNewPopup = true;
        } else if (part.fieldname === 'bannerFiles') {
          uploadedBannerUrls.push(data.publicUrl);
        }

      } else {
        if (part.fieldname === 'showPopup') showPopup = part.value === 'true';
        
        if (part.fieldname === 'bannerData') {
            try {
                bannerData = JSON.parse(part.value as string);
            } catch (e) { bannerData = [] }
        }
      }
    }

    // ประกอบร่าง Banner (Merge รูปเก่า + รูปใหม่ตามลำดับ)
    let newFileIndex = 0;
    
    const finalBanners = bannerData.map((item, index) => {
        let url = item.url;
        
        if (item.isNewFile) {
            url = uploadedBannerUrls[newFileIndex] || url;
            newFileIndex++;
        }

        return {
            id: item.id || randomUUID(),
            url: url,
            title: item.title || '',
            clickable: item.clickable || false,
            linkUrl: item.linkUrl || '',
            active: item.active,
            order: index + 1
        };
    });

    // Update Database
    const existing = await db.select().from(homeContent).limit(1);
    
    const updateData = {
        banners: finalBanners,
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
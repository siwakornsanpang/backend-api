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

// แปลง Supabase public URL → storage path เพื่อลบได้
function getStoragePath(publicUrl: string): string | null {
  if (!publicUrl) return null;
  const marker = '/storage/v1/object/public/uploads/';
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return publicUrl.substring(idx + marker.length);
}

// ลบไฟล์เก่าจาก Supabase Storage
async function deleteOldFiles(urls: string[]) {
  const paths = urls.map(getStoragePath).filter((p): p is string => !!p);
  if (paths.length === 0) return;

  try {
    await supabase.storage.from('uploads').remove(paths);
    console.log(`[cleanup] ลบรูปเก่า ${paths.length} ไฟล์:`, paths);
  } catch (e) {
    console.error('[cleanup] ลบรูปเก่าล้มเหลว:', e);
  }
}

export async function homeRoutes(app: FastifyInstance) {
  
  // GET: ดึงข้อมูลหน้าแรก
  app.get('/home-content', async () => {
    const content = await db.select().from(homeContent).limit(1);
    if (content.length === 0) {
      return { banners: [], popups: [] };
    }
    return content[0];
  });

  // POST: บันทึกข้อมูลหน้าแรก
  app.post('/home-content', { preHandler: [verifyToken, requirePermission('manage_home')] }, async (req, reply) => {
    const parts = req.parts();
    
    let bannerData: any[] = [];
    let popupData: any[] = [];
    let uploadedBannerUrls: string[] = [];
    let uploadedOriginalUrls: string[] = [];
    let uploadedPopupUrls: string[] = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename);
        const filename = `home/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const fileBuffer = await streamToBuffer(part.file);

        await supabase.storage.from('uploads').upload(filename, fileBuffer, {
           contentType: part.mimetype, upsert: true 
        });

        const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
        
        if (part.fieldname === 'bannerFiles') {
          uploadedBannerUrls.push(data.publicUrl);
        } else if (part.fieldname === 'originalBannerFiles') {
          uploadedOriginalUrls.push(data.publicUrl);
        } else if (part.fieldname === 'popupFiles') {
          uploadedPopupUrls.push(data.publicUrl);
        }

      } else {
        if (part.fieldname === 'bannerData') {
            try { bannerData = JSON.parse(part.value as string); } catch (e) { bannerData = [] }
        }
        if (part.fieldname === 'popupData') {
            try { popupData = JSON.parse(part.value as string); } catch (e) { popupData = [] }
        }
      }
    }

    // ดึงข้อมูลเก่าจาก DB เพื่อเปรียบเทียบ
    const existing = await db.select().from(homeContent).limit(1);
    const oldBanners: any[] = (existing.length > 0 && existing[0].banners) ? existing[0].banners as any[] : [];
    const oldPopups: any[] = (existing.length > 0 && existing[0].popups) ? existing[0].popups as any[] : [];

    // === ประกอบ Banners ===
    let newCroppedIndex = 0;
    let newOriginalIndex = 0;
    
    const finalBanners = bannerData.map((item, index) => {
        let url = item.url;
        let originalUrl = item.originalUrl || '';
        
        if (item.isNewFile) {
            url = uploadedBannerUrls[newCroppedIndex] || url;
            newCroppedIndex++;
        }
        if (item.isNewOriginal) {
            originalUrl = uploadedOriginalUrls[newOriginalIndex] || originalUrl;
            newOriginalIndex++;
        }

        return {
            id: item.id || randomUUID(),
            url, originalUrl,
            title: item.title || '',
            clickable: item.clickable || false,
            linkUrl: item.linkUrl || '',
            active: item.active,
            order: index + 1
        };
    });

    // === ประกอบ Popups ===
    let newPopupIndex = 0;

    const finalPopups = popupData.map((item, index) => {
        let url = item.url;

        if (item.isNewFile) {
            url = uploadedPopupUrls[newPopupIndex] || url;
            newPopupIndex++;
        }

        return {
            id: item.id || randomUUID(),
            url,
            title: item.title || '',
            active: item.active,
            order: index + 1
        };
    });

    // === หารูปเก่าที่ไม่ใช้แล้ว → ลบจาก Storage ===
    const newUrls = new Set<string>();
    finalBanners.forEach(b => { if (b.url) newUrls.add(b.url); if (b.originalUrl) newUrls.add(b.originalUrl); });
    finalPopups.forEach(p => { if (p.url) newUrls.add(p.url); });

    const urlsToDelete: string[] = [];
    oldBanners.forEach((old: any) => {
      if (old.url && !newUrls.has(old.url)) urlsToDelete.push(old.url);
      if (old.originalUrl && !newUrls.has(old.originalUrl)) urlsToDelete.push(old.originalUrl);
    });
    oldPopups.forEach((old: any) => {
      if (old.url && !newUrls.has(old.url)) urlsToDelete.push(old.url);
    });

    if (urlsToDelete.length > 0) deleteOldFiles(urlsToDelete);

    // === Update Database ===
    const updateData = {
        banners: finalBanners,
        popups: finalPopups,
        updatedAt: new Date()
    };

    if (existing.length > 0) {
      await db.update(homeContent).set(updateData).where(eq(homeContent.id, existing[0].id));
    } else {
      await db.insert(homeContent).values(updateData as any);
    }

    return { success: true };
  });
}
// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';
import { verifyToken, requireRole } from '../utils/authGuard';

// ✅ 1. เพิ่ม Helper Function นี้ไว้บนสุด (นอก export function)
// ฟังก์ชันนี้จะช่วยแปลง Stream เป็น Buffer โดยไม่ทำให้ล่มง่ายๆ
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// -------------------------------------------------------------
// Helper: ดึง URL รูปภาพทั้งหมดออกจาก HTML String
// -------------------------------------------------------------
function extractImageUrls(htmlContent: string): string[] {
  const urls: string[] = [];
  // Regex เพื่อจับ <img src="...">
  const regex = /<img[^>]+src="([^">]+)"/g;
  let match;
  while ((match = regex.exec(htmlContent)) !== null) {
    urls.push(match[1]); // match[1] คือค่าใน src="..."
  }
  return urls;
}

// -------------------------------------------------------------
// Helper: ดึง Path ของไฟล์ใน Supabase จาก URL
// ตัวอย่าง URL: https://xyz.supabase.co/storage/v1/object/public/uploads/news-content/abc.jpg
// Path ที่ต้องการ: news-content/abc.jpg
// -------------------------------------------------------------
function getFilePathFromUrl(url: string, bucketName: string = 'uploads'): string | null {
  try {
    // ตรวจสอบว่าเป็น URL ของ Supabase หรือไม่ (ปรับตาม URL จริงของคุณ)
    if (!url.includes(`/${bucketName}/`)) return null;

    const parts = url.split(`/${bucketName}/`);
    if (parts.length > 1) {
      return decodeURIComponent(parts[1]); // ต้อง decode เผื่อมี %20
    }
    return null;
  } catch (e) {
    console.error('Error parsing file path from URL:', e);
    return null;
  }
}

export async function newsRoutes(app: FastifyInstance) {

  // GET ... (เหมือนเดิม)
  app.get('/news', { preHandler: [verifyToken] }, async (req, reply) => {
    // ... code เดิม ...
    const { category, status } = req.query as { category?: string; status?: string };
    const conditions = [];
    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));
    const result = await db.select().from(news)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(news.createdAt));
    return result;
  });

  app.get('/news/:id', { preHandler: [verifyToken] }, async (req, reply) => {
    // ... code เดิม ...
    const { id } = req.params as { id: string };
    const result = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบข่าว' });
    return result[0];
  });

  // -------------------------------------------------------
  // ✅ 2. API Upload Image (แก้ไขใหม่ รับมือ Stream)
  // -------------------------------------------------------
  app.post('/news/upload-image', { preHandler: [verifyToken, requireRole('admin', 'editor')] }, async (req, reply) => {
    try {
      // เมื่อเอา attachFieldsToBody ออก เราต้องใช้ req.file()
      const data = await req.file();

      if (!data) {
        return reply.status(400).send({ message: 'No file uploaded' });
      }

      const ext = path.extname(data.filename);
      const filename = `news-content/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;

      // ✅ แปลง Stream เป็น Buffer ด้วยฟังก์ชันที่เราสร้างเอง
      const fileBuffer = await streamToBuffer(data.file);

      // Upload ขึ้น Supabase
      const { error } = await supabase.storage
        .from('uploads')
        .upload(filename, fileBuffer, {
          contentType: data.mimetype,
          upsert: true
        });

      if (error) {
        console.error('Supabase Error:', error);
        return reply.status(500).send({ message: 'Upload failed' });
      }

      const { data: publicData } = supabase.storage
        .from('uploads')
        .getPublicUrl(filename);

      return { url: publicData.publicUrl };

    } catch (err) {
      console.error('Upload Error:', err);
      return reply.status(500).send({ message: 'Internal Server Error' });
    }
  });

  // -------------------------------------------------------
  // ✅ 3. POST: สร้างข่าว (JSON Body ปกติ)
  // -------------------------------------------------------
  app.post('/news', { preHandler: [verifyToken, requireRole('admin', 'editor')] }, async (req, reply) => {
    // พอเอา attachFieldsToBody ออก Fastify จะกลับมาอ่าน JSON ใน req.body ได้ปกติโดยไม่ต้องทำอะไรเพิ่ม
    const { title, content, category, status, order, publishedAt } = req.body as any;

    if (!title || !content) {
      return reply.status(400).send({ message: 'Title and content are required' });
    }

    const result = await db.insert(news).values({
      title,
      content,
      category: category || 'news',
      status: status || 'draft',
      order: parseInt(order || '0'),
      // images: [],
      publishedAt: publishedAt ? new Date(publishedAt) : (status === 'published' ? new Date() : null),
    }).returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // ✅ 4. PUT: แก้ไขข่าว (รับ JSON)
  // -------------------------------------------------------
  app.put('/news/:id', { preHandler: [verifyToken, requireRole('admin', 'editor')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      // รับ JSON Body
      const { title, content, category, status, order, publishedAt } = req.body as any;
      // 1. เช็คว่ามีข่าวนี้จริงไหม และดึงเนื้อหาเก่ามา
      const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
      if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });
      // --------------------------------------------------------
      // [NEW] Logic ลบรูปออกจาก Supabase ถ้าถูกลบออกจาก Content
      // --------------------------------------------------------
      const oldContent = existing[0].content || '';
      const newContent = content || '';
      const oldImages = extractImageUrls(oldContent);
      const newImages = extractImageUrls(newContent);
      // หา Image ที่มีใน Old แต่ไม่มีใน New (คือถูกลบออก)
      const deletedImages = oldImages.filter(url => !newImages.includes(url));
      if (deletedImages.length > 0) {
        // แปลง URL ให้เป็น Path ที่ Supabase เข้าใจ (news-content/xxx.jpg)
        const filePathsToDelete = deletedImages
          .map(url => getFilePathFromUrl(url, 'uploads')) // 'uploads' คือชื่อ Bucket ของคุณ
          .filter((path): path is string => path !== null); // กรอง path ที่เป็น null ออก
        if (filePathsToDelete.length > 0) {
          console.log('Deleting images from Supabase:', filePathsToDelete);

          // สั่งลบทีเดียวหลายไฟล์
          const { error } = await supabase.storage
            .from('uploads')
            .remove(filePathsToDelete);
          if (error) {
            console.warn('Failed to delete some images from Supabase:', error);
            // ไม่ต้อง throw error ปล่อยผ่านได้ เพื่อให้ data ใน DB อัปเดตต่อไป
          }
        }
      }

      const updateData: any = {
        title,
        content,
        category,
        status,
        order: parseInt(order || '0'),
        updatedAt: new Date(),
        publishedAt: publishedAt ? new Date(publishedAt) : existing[0].publishedAt
      };

      // อัปเดตเวลา publish ถ้าเพิ่งเปลี่ยนสถานะเป็น published
      if (status === 'published' && !updateData.publishedAt) {
        updateData.publishedAt = new Date();
      }

      // สั่ง Update
      const result = await db.update(news)
        .set(updateData)
        .where(eq(news.id, parseInt(id)))
        .returning();
      return { success: true, data: result[0] };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to update news' });
    }
  });

  // DELETE: ลบข่าว
  app.delete('/news/:id', { preHandler: [verifyToken, requireRole('admin', 'editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(news).where(eq(news.id, parseInt(id)));
    return { success: true, message: 'ลบข่าวเรียบร้อย' };
  });
}
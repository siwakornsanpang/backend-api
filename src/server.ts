// src/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import path from "path";
import util from "util";
import { pipeline } from "stream";
import { db } from "./db";
import { pharmacists, homeContent } from "./db/schema";
import { eq } from "drizzle-orm";
import { createClient } from '@supabase/supabase-js';

// --- Setup ---
const app = Fastify({ logger: true });

// Supabase Config
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper แปลงไฟล์
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// --- Plugins ---
// 1. CORS: อนุญาตให้ Frontend ยิงเข้ามาได้ (ตอนนี้เปิดหมด true ไปก่อน เพื่อความง่ายในการ Test)
app.register(cors, {
  origin: true 
});

// 2. Multipart: รับไฟล์ได้สูงสุด 10MB
app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024,
  }
});

// (ลบ fastifyStatic ออกแล้ว เพราะไม่ได้ใช้)

// --- API Routes ---

// 1. ดึงข้อมูลเภสัชกร (ของเดิม)
app.get("/pharmacists", async () => await db.select().from(pharmacists));
// (ถ้ามี POST pharmacists ก็ใส่ไว้เหมือนเดิม)

// 2. ดึงข้อมูลหน้าแรก
app.get("/home-content", async () => {
  const content = await db.select().from(homeContent).limit(1);
  if (content.length === 0) return { welcomeMessage: "", bannerUrl: "" };
  return content[0];
});

// 3. บันทึกข้อมูล (อัปโหลดขึ้น Supabase)
// src/server.ts

// ... (ส่วน import และ config ข้างบนเหมือนเดิม) ...

app.post('/home-content', async (req, reply) => {
  const parts = req.parts();
  
  let welcomeMessage = '';
  let bannerUrl = '';
  let hasNewImage = false;

  // 1. วนลูปรับไฟล์และอัปโหลดรูปใหม่ (เหมือนเดิม)
  for await (const part of parts) {
    if (part.type === 'file') {
      hasNewImage = true;
      const ext = path.extname(part.filename);
      // ตั้งชื่อไฟล์ (banners/เวลา_เลขสุ่ม.นามสกุล)
      const filename = `banners/${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
      
      const fileBuffer = await streamToBuffer(part.file);
      
      // อัปโหลดรูปใหม่
      const { error } = await supabase
        .storage
        .from('uploads')
        .upload(filename, fileBuffer, {
          contentType: part.mimetype,
          upsert: true
        });

      if (error) throw new Error('Upload failed: ' + error.message);

      // ขอ URL
      const { data: publicData } = supabase
        .storage
        .from('uploads')
        .getPublicUrl(filename);
        
      bannerUrl = publicData.publicUrl;

    } else {
      if (part.fieldname === 'welcomeMessage') {
        welcomeMessage = part.value as string;
      }
    }
  }

  // 2. จัดการกับข้อมูลเก่าใน Database
  const existing = await db.select().from(homeContent).limit(1);
  
  if (existing.length > 0) {
    // 🔥 [ใหม่] ส่วนลบรูปเก่าออกจาก Cloud (Supabase)
    if (hasNewImage && existing[0].bannerUrl) {
      try {
        const oldUrl = existing[0].bannerUrl;
        
        // ตัวอย่าง URL: https://xyz.supabase.co/.../public/uploads/banners/123.jpg
        // เราต้องการแค่: "banners/123.jpg"
        // วิธีตัด: แยกคำว่า '/uploads/' แล้วเอาตัวข้างหลังมา
        const pathToRemove = oldUrl.split('/uploads/').pop(); 

        if (pathToRemove) {
          console.log('กำลังลบรูปเก่าบน Cloud:', pathToRemove);
          
          const { error: removeError } = await supabase
            .storage
            .from('uploads')
            .remove([pathToRemove]); // สั่งลบไฟล์

          if (removeError) {
            console.error('ลบรูปเก่าไม่สำเร็จ:', removeError.message);
          } else {
            console.log('✅ ลบรูปเก่าเรียบร้อยแล้ว');
          }
        }
      } catch (err) {
        console.error("เกิดข้อผิดพลาดตอนลบไฟล์เก่า (แต่ทำงานต่อ):", err);
      }
    }
    // -----------------------------------------------------

    // อัปเดตข้อมูลลง DB
    await db.update(homeContent).set({
      welcomeMessage: welcomeMessage || existing[0].welcomeMessage,
      ...(hasNewImage ? { bannerUrl } : {}),
      updatedAt: new Date()
    }).where(eq(homeContent.id, existing[0].id));
    
  } else {
    // Insert ใหม่
    await db.insert(homeContent).values({
      welcomeMessage: welcomeMessage,
      bannerUrl: bannerUrl
    });
  }

  return { success: true, message: 'อัปเดตข้อมูลสำเร็จ!', url: bannerUrl };
});

// --- Server Start ---
const start = async () => {
  try {
    // (ลบส่วนสร้าง folder uploads ทิ้งแล้ว)

    await app.listen({ 
      port: Number(process.env.PORT) || 8080, 
      host: '0.0.0.0' // สำคัญมากสำหรับ Render
    });
    console.log(`Server running at ${app.server.address()}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
// src/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart"; // ตัวรับไฟล์
import fastifyStatic from "@fastify/static"; // ตัวโชว์รูป
import path from "path";
import fs from "fs";
import util from "util";
import { pipeline } from "stream";
import { db } from "./db";
import { pharmacists, homeContent } from "./db/schema";
import { eq } from "drizzle-orm";

const pump = util.promisify(pipeline);
const app = Fastify({ logger: true });

// --- Plugins ---
app.register(cors, {
  origin: [
    'http://localhost:3000', // อนุญาตหน้าบ้าน
    'http://localhost:3001'  // อนุญาตหลังบ้าน (Admin)
  ]
});
app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB (หน่วยเป็น Byte)
  }
});
app.register(fastifyStatic, {
  root: path.join(__dirname, "../uploads"),
  prefix: "/uploads/",
});

// --- API เดิม (เภสัชกร) ---
app.get("/pharmacists", async () => await db.select().from(pharmacists));
// ... (API POST pharmacists เดิมของคุณเก็บไว้เหมือนเดิม) ...

// --- API ใหม่: จัดการหน้าแรก (Home Content) ---

// 1. ดึงข้อมูลมาโชว์
app.get("/home-content", async () => {
  const content = await db.select().from(homeContent).limit(1);
  if (content.length === 0) return { welcomeMessage: "", bannerUrl: "" };
  return content[0];
});

// 2. บันทึกข้อมูล (รับไฟล์รูป + ข้อความ)
app.post("/home-content", async (req, reply) => {
  const parts = req.parts();
  let welcomeMessage = "";
  let bannerUrl = "";
  let hasNewImage = false;

  for await (const part of parts) {
    if (part.type === "file") {
      hasNewImage = true;

      // ❌ ของเดิม: ใช้ part.filename (ซึ่งอาจเป็นภาษาไทย)
      // const filename = `${Date.now()}-${part.filename}`;

      // ✅ ของใหม่: ตั้งชื่อใหม่เลย (ใช้นามสกุลไฟล์เดิม)
      const ext = path.extname(part.filename); // ดึงนามสกุลไฟล์ เช่น .jpg, .png
      const filename = `${Date.now()}${ext}`; // ตั้งชื่อเป็นตัวเลขเวลา (เช่น 1770090123.jpg)

      const savePath = path.join(__dirname, "../uploads", filename);
      await pump(
        part.file,
        fs.createWriteStream(path.join(__dirname, "../uploads", filename)),
      );
      bannerUrl = `http://localhost:8080/uploads/${filename}`;
    } else {
      // ถ้าเป็นข้อความ
      if (part.fieldname === "welcomeMessage")
        welcomeMessage = part.value as string;
    }
  }

  // บันทึกลง DB
const existing = await db.select().from(homeContent).limit(1);
  
  if (existing.length > 0) {
    // --- 🔥 เพิ่มโค้ดลบรูปเก่าตรงนี้ (เฉพาะกรณีที่มีการอัปรูปใหม่) ---
    if (hasNewImage && existing[0].bannerUrl) {
      try {
        // แกะชื่อไฟล์เก่าจาก URL (เช่น http://localhost:8080/uploads/123.jpg -> เอาแค่ 123.jpg)
        const oldUrl = existing[0].bannerUrl;
        const oldFilename = oldUrl.split('/').pop(); // ดึงตัวสุดท้ายหลัง /
        
        if (oldFilename) {
          const oldFilePath = path.join(__dirname, '../uploads', oldFilename);
          
          // เช็คว่ามีไฟล์อยู่จริงไหม ถ้ามีก็ลบทิ้งเลย
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
            console.log(`🗑️ Deleted old image: ${oldFilename}`);
          }
        }
      } catch (err) {
        console.error("ลบไฟล์เก่าไม่สำเร็จ (แต่ไม่เป็นไร ทำงานต่อได้):", err);
      }
    }
    // -----------------------------------------------------------

    // อัปเดตข้อมูลใหม่ลง Database
    await db.update(homeContent).set({
      welcomeMessage: welcomeMessage || existing[0].welcomeMessage,
      ...(hasNewImage ? { bannerUrl } : {}), // อัปเดต URL เฉพาะเมื่อมีรูปใหม่
      updatedAt: new Date()
    }).where(eq(homeContent.id, existing[0].id));
    
  } else {
    // ถ้ายังไม่มีข้อมูลเลย ก็ Insert ใหม่
    await db.insert(homeContent).values({
      welcomeMessage: welcomeMessage,
      bannerUrl: bannerUrl
    });
  }

  return { success: true, message: 'บันทึกเรียบร้อย (ลบรูปเก่าให้แล้ว)' };
});

const start = async () => {
  try {
    // 🔥 เพิ่มท่อนนี้: เช็คว่ามีโฟลเดอร์ uploads ไหม? ถ้าไม่มีให้สร้างเลย
    const uploadDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
      console.log("Created uploads folder automatically ✅");
    }

    await app.listen({ port: 8080 });
    console.log("Server running at http://localhost:8080");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();

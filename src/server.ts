// src/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";

// Import Route ที่เราแยกไว้
import { homeRoutes } from "./routes/home";
import { pharmacistRoutes } from "./routes/pharmacists";
import { lawRoutes } from "./routes/laws";
import { councilRoutes } from "./routes/council";
import { newsRoutes } from "./routes/news";
import { historyRoutes } from "./routes/history";
import { agencyRoutes } from "./routes/agencies";

const app = Fastify({ logger: true });

// --- 1. Plugins (ของกลาง) ---
app.register(cors, {
  origin: true, // อนุญาตทุกโดเมน (เหมือนเดิม)
  // 🔥 เพิ่มบรรทัดนี้: อนุญาตให้ใช้ท่าไหนได้บ้าง (ต้องระบุ DELETE, PUT ด้วย)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], 
  // 🔥 เพิ่มบรรทัดนี้: อนุญาต Header อะไรบ้าง (กันเหนียว)
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});// อนุญาตให้เชื่อมต่อข้ามโดเมน

// ✅ แก้ไขตรงนี้: เพิ่ม attachFieldsToBody: true
app.register(multipart, { 
    attachFieldsToBody: true, // สำคัญมาก! แปลงไฟล์และ field ให้เป็น object ใน req.body
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// --- 2. Register Routes (เรียกใช้ไฟล์แยก) ---
app.register(homeRoutes);       // ✅ โหลด API หน้าแรก
app.register(pharmacistRoutes); // ✅ โหลด API เภสัชกร
app.register(lawRoutes);
app.register(councilRoutes);
app.register(newsRoutes);       // ✅ โหลด API ข่าวสาร 
app.register(historyRoutes);
app.register(agencyRoutes);       // ✅ โหลด API หน่วยงาน

// --- 3. Start Server ---
const start = async () => {
  try {
    await app.listen({ 
      port: Number(process.env.PORT) || 8080, 
      host: '0.0.0.0' 
    });
    console.log(`🚀 Server running at ${app.server.address()}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
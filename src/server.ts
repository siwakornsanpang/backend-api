// src/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";

// Import Route ที่เราแยกไว้
import { homeRoutes } from "./routes/home";
import { pharmacistRoutes } from "./routes/pharmacists";
import { lawRoutes } from "./routes/laws";

const app = Fastify({ logger: true });

// --- 1. Plugins (ของกลาง) ---
app.register(cors, { origin: true }); // อนุญาตให้เชื่อมต่อข้ามโดเมน
app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // รับไฟล์ได้ 10MB

// --- 2. Register Routes (เรียกใช้ไฟล์แยก) ---
app.register(homeRoutes);       // ✅ โหลด API หน้าแรก
app.register(pharmacistRoutes); // ✅ โหลด API เภสัชกร
app.register(lawRoutes);

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
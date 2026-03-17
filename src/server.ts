// src/server.ts
import 'dotenv/config';
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";

// Import Route ที่เราแยกไว้
import { homeRoutes } from "./routes/home";
import { pharmacistRoutes } from "./routes/pharmacists";
import { lawRoutes } from "./routes/laws";
import { councilRoutes } from "./routes/council";
import { newsRoutes } from "./routes/news";
import { historyRoutes } from "./routes/history";
import { agencyRoutes } from "./routes/agencies";
import { authRoutes } from "./routes/auth";
import { permissionRoutes } from "./routes/permissions";
import { webSettingRoutes } from "./routes/setting";
import { honorRoutes } from "./routes/honor";
import { serviceRoutes } from "./routes/services";

const app = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024,   // 100MB (รองรับวิดีโอขนาดใหญ่)
  requestTimeout: 5 * 60 * 1000,  // 5 นาที (รองรับอัปโหลดไฟล์ใหญ่)
});

// --- 1. Plugins (ของกลาง) ---

// JWT Plugin
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set in .env — กรุณาตั้งค่า');
  process.exit(1);
}
app.register(jwt, {
  secret: process.env.JWT_SECRET,
});

// Rate Limiting (ป้องกัน brute force)
app.register(rateLimit, {
  max: 100,            // ทั่วไป: 100 requests ต่อนาที
  timeWindow: '1 minute',
});

// CORS
app.register(cors, {
  origin: [
    'http://localhost:3000',                          // dev
    'http://localhost:3001',                          // dev alt
    process.env.FRONTEND_URL || 'http://localhost:3000', // production
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// Multipart (สำหรับ upload ไฟล์)
app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB (รองรับวิดีโอยาวๆ)
});

// --- 2. Register Routes ---
app.register(authRoutes);         // ✅ Auth (login, me, seed, user management)
app.register(permissionRoutes);   // ✅ สิทธิ์ (permissions, role-permissions)
app.register(homeRoutes);         // ✅ หน้าแรก
app.register(pharmacistRoutes);   // ✅ เภสัชกร
app.register(lawRoutes);          // ✅ กฎหมาย
app.register(councilRoutes);      // ✅ กรรมการสภา
app.register(newsRoutes);         // ✅ ข่าวสาร
app.register(historyRoutes);      // ✅ ทำเนียบสภา
app.register(agencyRoutes);       // ✅ หน่วยงาน
app.register(webSettingRoutes);    // ✅ ตั้งค่าเว็บไซต์
app.register(honorRoutes);         // ✅ เกียรติประวัติ
app.register(serviceRoutes);       // ✅ บริการ (Service E)

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
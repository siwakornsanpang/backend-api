import 'dotenv/config'; // โหลดค่าจากไฟล์ .env
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './drizzle',      // ให้เก็บไฟล์ประวัติการแก้ไขไว้ที่โฟลเดอร์นี้
  schema: './src/db/schema.ts', // บอกตำแหน่งไฟล์ schema ที่เราเขียนไว้
  dialect: 'postgresql', // บอกว่าเป็น Database แบบ Postgres
  dbCredentials: {
    url: process.env.DATABASE_URL!, // ดึงลิงก์เชื่อมต่อมาจาก .env
  },
});
// src/db/index.ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema'; // เอาตารางที่เราสร้างไว้มาด้วย

// สร้าง Connection Pool (ท่อส่งข้อมูล)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ส่งออกตัวแปร db ให้ไฟล์อื่นเอาไปใช้ได้
export const db = drizzle(pool, { schema });
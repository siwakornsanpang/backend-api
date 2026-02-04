// src/routes/pharmacists.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db'; // ถอยกลับไป 1 ชั้นเพื่อหา db
import { pharmacists } from '../db/schema';

export async function pharmacistRoutes(app: FastifyInstance) {
  // GET: ดึงข้อมูลเภสัชกร
  app.get('/pharmacists', async () => {
    return await db.select().from(pharmacists);
  });
  
  // (ถ้าอนาคตมี POST/PUT/DELETE เภสัชกร ก็มาเขียนต่อในนี้ได้เลย)
}
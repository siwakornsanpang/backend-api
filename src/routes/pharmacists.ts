// src/routes/pharmacist.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { pharmacists } from '../db/schema';
import { ilike, or, eq } from 'drizzle-orm';

export async function pharmacistRoutes(app: FastifyInstance) {

  // GET /api/pharmacists
  // หรือ /api/pharmacists?q=ภักดี (ค้นหา)
  app.get('/pharmacists', async (req, reply) => {
    const { q } = req.query as { q?: string }; // รับค่า query string ชื่อ q

    // ถ้าไม่มีการค้นหา ให้ส่งกลับไปทั้งหมด (หรือจำกัดแค่ 20 คน)
    if (!q) {
      const result = await db.select().from(pharmacists).limit(50);
      return result;
    }

    // ถ้ามีการค้นหา (Search Logic)
    // ค้นหาจาก ชื่อ หรือ เลขใบอนุญาต หรือ จังหวัด
    const searchStr = `%${q}%`; // ใส่ % หน้าหลังเพื่อหาบางส่วนของคำ
    
    const result = await db.select()
      .from(pharmacists)
      .where(
        or(
          ilike(pharmacists.name, searchStr),          // ชื่อเหมือน...
          ilike(pharmacists.registrationId, searchStr), // เลข ภ. เหมือน...
          ilike(pharmacists.province, searchStr)        // จังหวัดเหมือน...
        )
      );

    return result;
  });

  // GET /api/pharmacists/:id (เผื่อกดดูรายละเอียด)
  app.get('/pharmacists/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db.select()
        .from(pharmacists)
        .where(eq(pharmacists.id, parseInt(id)))
        .limit(1);
        
    return result[0] || reply.status(404).send({ message: "ไม่พบข้อมูล" });
  });
}
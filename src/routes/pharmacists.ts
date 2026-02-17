// src/routes/pharmacist.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { pharmacists } from '../db/schema';
import { ilike, or, eq ,asc} from 'drizzle-orm';


export async function pharmacistRoutes(app: FastifyInstance) {

  // GET /api/pharmacists
  // หรือ /api/pharmacists?q=ภักดี (ค้นหา)
app.get('/pharmacists', async (req, reply) => {
  const { q } = req.query as { q?: string };

  // กรณี 1: ไม่มีการค้นหา (ตัวปัญหาคือตรงนี้)
  if (!q) {
    const result = await db.select()
      .from(pharmacists)
      .orderBy(asc(pharmacists.id)) // <--- เพิ่มบรรทัดนี้! (เรียงตาม ID)
      .limit(50);
    return result;
  }

  // กรณี 2: มีการค้นหา (ควรเพิ่มด้วยเหมือนกัน)
  const searchStr = `%${q}%`;
  const result = await db.select()
    .from(pharmacists)
    .where(
      or(
        ilike(pharmacists.name, searchStr),
        ilike(pharmacists.registrationId, searchStr),
        ilike(pharmacists.province, searchStr),
        ilike(pharmacists.address, searchStr)
      )
    )
    .orderBy(asc(pharmacists.id)); // <--- เพิ่มตรงนี้ด้วยก็ดีครับ

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
// src/routes/news.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, asc, and } from 'drizzle-orm';

export async function newsRoutes(app: FastifyInstance) {

  // 1. GET: ดึงข่าวทั้งหมด พร้อม filter
  // /news
  // /news?category=news
  // /news?status=published
  // /news?category=activity&status=published
  app.get('/news', async (req, reply) => {
    const { category, status } = req.query as { category?: string; status?: string };
    
    let query = db.select().from(news);
    const conditions = [];

    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const result = await query.orderBy(asc(news.order));
    return result;
  });

  // 2. GET: ดึงข่าว 1 อัน ตามรหัส
  app.get('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await db.select()
      .from(news)
      .where(eq(news.id, parseInt(id)))
      .limit(1);
    
    return result[0] || reply.status(404).send({ message: 'ไม่พบข่าว' });
  });
}

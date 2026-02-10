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
    
    const conditions = [];

    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));

    let query = db.select().from(news);
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

  // 3. POST: สร้างข่าวใหม่
  app.post('/news', async (req, reply) => {
    const { title, content, category, status, order } = req.body as {
      title: string;
      content: string;
      category: 'news' | 'activity' | 'announcement';
      status: 'draft' | 'published';
      order: number;
    };

    if (!title || !content) {
      return reply.status(400).send({ message: 'ต้องระบุ title และ content' });
    }

    const result = await db.insert(news).values({
      title,
      content,
      category: category || 'news',
      status: status || 'draft',
      order: order || 0,
      publishedAt: status === 'published' ? new Date() : null,
    }).returning();

    return { success: true, data: result[0] };
  });

  // 4. PUT: แก้ไขข่าว
  app.put('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { title, content, category, status, order } = req.body as {
      title?: string;
      content?: string;
      category?: 'news' | 'activity' | 'announcement';
      status?: 'draft' | 'published';
      order?: number;
    };

    const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (existing.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบข่าว' });
    }

    const updateData: any = {};
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (category) updateData.category = category;
    if (status) {
      updateData.status = status;
      if (status === 'published' && !existing[0].publishedAt) {
        updateData.publishedAt = new Date();
      }
    }
    if (order !== undefined) updateData.order = order;
    updateData.updateAt = new Date();

    const result = await db.update(news).set(updateData).where(eq(news.id, parseInt(id))).returning();

    return { success: true, data: result[0] };
  });

  // 5. DELETE: ลบข่าว
  app.delete('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (existing.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบข่าว' });
    }

    await db.delete(news).where(eq(news.id, parseInt(id)));

      return { success: true, message: 'ลบข่าวเรียบร้อย' };
    });
  
  }

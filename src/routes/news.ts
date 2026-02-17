import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { news } from '../db/schema';
import { eq, asc, desc, and } from 'drizzle-orm'; // เพิ่ม desc เผื่อใช้

export async function newsRoutes(app: FastifyInstance) {

  // -------------------------------------------------------
  // 1. GET: ดึงข่าวทั้งหมด พร้อม filter
  // -------------------------------------------------------
  app.get('/news', async (req, reply) => {
    const { category, status } = req.query as { category?: string; status?: string };
    
    const conditions = [];

    if (category) conditions.push(eq(news.category, category as any));
    if (status) conditions.push(eq(news.status, status as any));

    const result = await db
      .select()
      .from(news)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(news.order)); // หรือใช้ desc(news.createdAt) เพื่อเรียงข่าวใหม่สุดขึ้นก่อน

    return result;
  });

  // -------------------------------------------------------
  // 2. GET: ดึงข่าว 1 อัน ตามรหัส
  // -------------------------------------------------------
  app.get('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    
    const result = await db.select()
      .from(news)
      .where(eq(news.id, parseInt(id)))
      .limit(1);
    
    if (result.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบข่าว' });
    }

    return result[0];
  });

  // -------------------------------------------------------
  // 3. POST: สร้างข่าวใหม่ (รองรับรูปภาพหลายรูป)
  // -------------------------------------------------------
  app.post('/news', async (req, reply) => {
    // รับ images เป็น array ของ string (URL)
    const { title, content, category, status, order, images } = req.body as {
      title: string;
      content: string;
      category: 'news' | 'activity' | 'announcement';
      status: 'draft' | 'published';
      order: number;
      images?: string[]; // ✅ เพิ่มตรงนี้
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
      images: images || [], // ✅ บันทึกลง DB (ถ้าไม่มีส่งมาให้เป็น array ว่าง)
      publishedAt: status === 'published' ? new Date() : null,
    }).returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // 4. PUT: แก้ไขข่าว
  // -------------------------------------------------------
  app.put('/news/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { title, content, category, status, order, images } = req.body as {
      title?: string;
      content?: string;
      category?: 'news' | 'activity' | 'announcement';
      status?: 'draft' | 'published';
      order?: number;
      images?: string[]; // ✅ เพิ่มตรงนี้
    };

    // เช็คก่อนว่ามีข่าวไหม
    const existing = await db.select().from(news).where(eq(news.id, parseInt(id))).limit(1);
    if (existing.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบข่าว' });
    }

    const updateData: any = {};
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (category) updateData.category = category;
    
    // ✅ อัปเดต Array รูปภาพ (ถ้ามีการส่งค่ามาใหม่)
    if (images !== undefined) updateData.images = images;

    if (status) {
      updateData.status = status;
      // ถ้าเปลี่ยนเป็น published และยังไม่เคย publish มาก่อน ให้ใส่วันที่
      if (status === 'published' && !existing[0].publishedAt) {
        updateData.publishedAt = new Date();
      }
    }
    if (order !== undefined) updateData.order = order;
    
    updateData.updatedAt = new Date(); // อัปเดตเวลาแก้ไขล่าสุดเสมอ

    const result = await db.update(news)
      .set(updateData)
      .where(eq(news.id, parseInt(id)))
      .returning();

    return { success: true, data: result[0] };
  });

  // -------------------------------------------------------
  // 5. DELETE: ลบข่าว
  // -------------------------------------------------------
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
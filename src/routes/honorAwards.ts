// src/routes/honorAwards.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { honorAwards, honors } from '../db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';

export async function honorAwardsRoutes(app: FastifyInstance) {

  // 1. GET: ดึงรายการรางวัลทั้งหมด (+ count ผู้ได้รับ)
  app.get('/honor-awards', async (req, reply) => {
    const awards = await db.select({
      id: honorAwards.id,
      order: honorAwards.order,
      name: honorAwards.name,
      description: honorAwards.description,
      createdAt: honorAwards.createdAt,
      recipientCount: sql<number>`(SELECT COUNT(*) FROM honors WHERE honors.award_id = ${honorAwards.id})`.as('recipient_count'),
    })
      .from(honorAwards)
      .orderBy(asc(honorAwards.order));

    return awards;
  });

  // 2. POST: สร้างรางวัลใหม่
  app.post('/honor-awards', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const { name, description, order } = req.body as { name: string; description?: string; order?: number };

    if (!name || !name.trim()) {
      return reply.status(400).send({ message: 'ชื่อรางวัลจำเป็นต้องกรอก' });
    }

    // ถ้าไม่ระบุ order ให้ใส่ค่าสูงสุด + 1
    let finalOrder = order ?? 0;
    if (!order) {
      const maxOrder = await db.select({ max: sql<number>`COALESCE(MAX(${honorAwards.order}), 0)` }).from(honorAwards);
      finalOrder = (maxOrder[0]?.max ?? 0) + 1;
    }

    const result = await db.insert(honorAwards).values({
      name: name.trim(),
      description: description?.trim() || null,
      order: finalOrder,
    }).returning();

    return { success: true, data: result[0] };
  });

  // 3. PUT: แก้ไขรางวัล
  app.put('/honor-awards/:id', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name, description } = req.body as { name?: string; description?: string };

    const existing = await db.select().from(honorAwards).where(eq(honorAwards.id, parseInt(id))).limit(1);
    if (!existing.length) return reply.status(404).send({ message: 'Not found' });

    await db.update(honorAwards).set({
      name: name?.trim() || existing[0].name,
      description: description !== undefined ? (description?.trim() || null) : existing[0].description,
    }).where(eq(honorAwards.id, parseInt(id)));

    return { success: true };
  });

  // 4. PUT: จัดเรียงลำดับรางวัล
  app.put('/honor-awards/reorder', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const items = req.body as { id: number; order: number }[];
    if (!Array.isArray(items)) {
      return reply.status(400).send({ message: 'Invalid format' });
    }

    for (const item of items) {
      await db.update(honorAwards)
        .set({ order: item.order })
        .where(eq(honorAwards.id, item.id));
    }

    return { success: true };
  });

  // 5. DELETE: ลบรางวัล + ลบผู้ได้รับทั้งหมดในรางวัลนี้
  app.delete('/honor-awards/:id', { preHandler: [verifyToken, requirePermission('manage_council')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const awardId = parseInt(id);

    // ลบผู้ได้รับรางวัลทั้งหมดในรางวัลนี้ก่อน
    await db.delete(honors).where(eq(honors.awardId, awardId));
    // ลบรางวัล
    await db.delete(honorAwards).where(eq(honorAwards.id, awardId));

    return { success: true };
  });
}

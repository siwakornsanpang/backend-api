// src/routes/agencies.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { agencies } from '../db/schema';
import { eq, asc } from 'drizzle-orm';

export async function agencyRoutes(app: FastifyInstance) {

  // 1. GET: ดึงหน่วยงานทั้งหมด (รองรับ filter ?status=online)
  app.get('/agencies', async (req, reply) => {
    const { status } = req.query as { status?: string };

    if (status) {
      return await db.select()
        .from(agencies)
        .where(eq(agencies.status, status))
        .orderBy(asc(agencies.order));
    }

    return await db.select()
      .from(agencies)
      .orderBy(asc(agencies.order));
  });

  // 2. POST: เพิ่มหน่วยงานใหม่
  app.post('/agencies', async (req, reply) => {
    const { name, url, status, order } = req.body as {
      name: string;
      url: string;
      status?: string;
      order?: number;
    };

    if (!name || !url) {
      return reply.status(400).send({ message: 'ต้องระบุ name และ url' });
    }

    const result = await db.insert(agencies).values({
      name,
      url,
      status: status || 'offline',
      order: order || 0,
    }).returning();

    return { success: true, data: result[0] };
  });

  // 3. PUT: แก้ไขหน่วยงาน
  app.put('/agencies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name, url, status, order } = req.body as {
      name?: string;
      url?: string;
      status?: string;
      order?: number;
    };

    const existing = await db.select().from(agencies).where(eq(agencies.id, parseInt(id))).limit(1);
    if (existing.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบหน่วยงาน' });
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (url) updateData.url = url;
    if (status) updateData.status = status;
    if (order !== undefined) updateData.order = order;

    const result = await db.update(agencies)
      .set(updateData)
      .where(eq(agencies.id, parseInt(id)))
      .returning();

    return { success: true, data: result[0] };
  });

  // 4. DELETE: ลบหน่วยงาน
  app.delete('/agencies/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    const existing = await db.select().from(agencies).where(eq(agencies.id, parseInt(id))).limit(1);
    if (existing.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบหน่วยงาน' });
    }

    await db.delete(agencies).where(eq(agencies.id, parseInt(id)));
    return { success: true, message: 'ลบหน่วยงานเรียบร้อย' };
  });
}

// src/routes/policy.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { policyCategories, policyProjects } from '../db/schema';
import { eq, asc, sql } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

export async function policyRoutes(app: FastifyInstance) {

  // --- Policy Categories ---

  // 1. GET: ดึงหมวดหมู่นโยบายทั้งหมด (+ นับจำนวนโครงการ)
  app.get('/policy-categories', async (req, reply) => {
    const allCategories = await db.select()
      .from(policyCategories)
      .orderBy(asc(policyCategories.order));

    const counts = await db.select({
      categoryId: policyProjects.categoryId,
      count: sql<number>`CAST(COUNT(*) AS INTEGER)`,
    })
      .from(policyProjects)
      .groupBy(policyProjects.categoryId);

    const countMap = new Map(counts.map(c => [c.categoryId, c.count]));

    return allCategories.map(cat => ({
      ...cat,
      projectCount: countMap.get(cat.id) ?? 0,
    }));
  });

  // 2. GET: ดึงหมวดหมู่เดียว
  app.get('/policy-categories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db.select().from(policyCategories).where(eq(policyCategories.id, parseInt(id))).limit(1);
    if (!result.length) return reply.status(404).send({ message: 'Not found' });
    return result[0];
  });

  // 3. POST: เพิ่มหมวดหมู่ใหม่
  app.post('/policy-categories', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const { title, order } = req.body as { title: string; order?: number };

    if (!title) return reply.status(400).send({ message: 'Title is required' });

    let finalOrder = order ?? 0;
    if (!order) {
      const maxOrder = await db.select({ max: sql<number>`COALESCE(MAX(${policyCategories.order}), 0)` }).from(policyCategories);
      finalOrder = (maxOrder[0]?.max ?? 0) + 1;
    }

    const result = await db.insert(policyCategories).values({
      title,
      order: finalOrder,
    }).returning();

    return { success: true, data: result[0] };
  });

  // 4. PUT: แก้ไขหมวดหมู่
  app.put('/policy-categories/:id', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { title, order } = req.body as { title?: string; order?: number };
    
    await db.update(policyCategories).set({
      title: title || undefined,
      order: order !== undefined ? order : undefined,
    }).where(eq(policyCategories.id, parseInt(id)));

    return { success: true };
  });

  // 5. PUT: จัดเรียงหมวดหมู่
  app.put('/policy-categories/reorder', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const items = req.body as { id: number; order: number }[];
    for (const item of items) {
      await db.update(policyCategories).set({ order: item.order }).where(eq(policyCategories.id, item.id));
    }
    return { success: true };
  });

  // 6. DELETE: ลบหมวดหมู่
  app.delete('/policy-categories/:id', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const catId = parseInt(id);

    // ลบโครงการลูกและไฟล์ PDF ของโครงการลูกด้วย
    const childProjects = await db.select().from(policyProjects).where(eq(policyProjects.categoryId, catId));
    const urlsToDelete = childProjects.map(p => p.summaryPdfUrl).filter(Boolean) as string[];
    if (urlsToDelete.length > 0) await deleteFromStorage(urlsToDelete);

    await db.delete(policyCategories).where(eq(policyCategories.id, catId));
    return { success: true };
  });

  // --- Policy Projects ---

  // 7. GET: ดึงโครงการ (filter by categoryId)
  app.get('/policy-projects', async (req, reply) => {
    const { categoryId } = req.query as { categoryId?: string };
    let query = db.select().from(policyProjects).orderBy(asc(policyProjects.order));
    if (categoryId) {
      query = query.where(eq(policyProjects.categoryId, parseInt(categoryId))) as any;
    }
    return await query;
  });

  // 8. POST: เพิ่มโครงการใหม่
  app.post('/policy-projects', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const parts = req.parts();
    let name = '', status = 'planned', order = 0, categoryId = 0;
    let summaryPdfUrl = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'summaryPdf') {
          const u = await uploadToStorage('policy', buffer, part.filename, part.mimetype, 'project_summary');
          if (u) summaryPdfUrl = u;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'status') status = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'categoryId') categoryId = parseInt(part.value as string);
      }
    }

    if (!name || !categoryId) return reply.status(400).send({ message: 'Name and categoryId are required' });

    if (!order) {
      const maxOrder = await db.select({ max: sql<number>`COALESCE(MAX(${policyProjects.order}), 0)` }).from(policyProjects).where(eq(policyProjects.categoryId, categoryId));
      order = (maxOrder[0]?.max ?? 0) + 1;
    }

    await db.insert(policyProjects).values({
      categoryId,
      name,
      summaryPdfUrl: summaryPdfUrl || null,
      status,
      order,
    });
    return { success: true };
  });

  // 9. PUT: แก้ไขโครงการ
  app.put('/policy-projects/:id', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parts = req.parts();
    
    const existing = await db.select().from(policyProjects).where(eq(policyProjects.id, parseInt(id))).limit(1);
    if (!existing.length) return reply.status(404).send({ message: 'Not found' });

    let name, status, order;
    let summaryPdfUrl: string | undefined;
    let removePdf = false;

    for await (const part of parts) {
      if (part.type === 'file') {
        const buffer = await streamToBuffer(part.file);
        if (part.fieldname === 'summaryPdf') {
          const u = await uploadToStorage('policy', buffer, part.filename, part.mimetype, 'project_summary');
          if (u) summaryPdfUrl = u;
        }
      } else {
        if (part.fieldname === 'name') name = part.value as string;
        if (part.fieldname === 'status') status = part.value as string;
        if (part.fieldname === 'order') order = parseInt(part.value as string);
        if (part.fieldname === 'removePdf' && part.value === 'true') removePdf = true;
      }
    }

    if ((summaryPdfUrl || removePdf) && existing[0].summaryPdfUrl) {
      await deleteFromStorage([existing[0].summaryPdfUrl]);
    }

    await db.update(policyProjects).set({
      name: name || existing[0].name,
      summaryPdfUrl: removePdf ? null : (summaryPdfUrl || existing[0].summaryPdfUrl),
      status: status || existing[0].status,
      order: order !== undefined ? order : existing[0].order,
    }).where(eq(policyProjects.id, parseInt(id)));

    return { success: true };
  });

  // 10. PUT: จัดเรียงโครงการ
  app.put('/policy-projects/reorder', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const items = req.body as { id: number; order: number }[];
    for (const item of items) {
      await db.update(policyProjects).set({ order: item.order }).where(eq(policyProjects.id, item.id));
    }
    return { success: true };
  });

  // 11. DELETE: ลบโครงการ
  app.delete('/policy-projects/:id', { preHandler: [verifyToken, requirePermission('manage_about')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = await db.select().from(policyProjects).where(eq(policyProjects.id, parseInt(id))).limit(1);
    if (target.length > 0 && target[0].summaryPdfUrl) {
      await deleteFromStorage([target[0].summaryPdfUrl]);
    }
    await db.delete(policyProjects).where(eq(policyProjects.id, parseInt(id)));
    return { success: true };
  });
}

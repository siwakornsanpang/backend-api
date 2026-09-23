import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db';
import {
  academyCategories,
  academyCourses,
  academyEnrollments,
  academyLearners,
  academyOrders,
} from '../db/schema';
import { getPharmacyAssertionIdentity, verifyPharmacyAssertion } from '../utils/pharmacyAssertion';
import { requirePermission, verifyToken } from '../utils/authGuard';

const PAGE_SIZE_DEFAULT = 12;
const PAGE_SIZE_MAX = 100;

function paging(query: Record<string, unknown>) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(String(query.limit ?? PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT));
  return { page, limit, offset: (page - 1) * limit };
}

function text(value: unknown, max = 255) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

function optionalText(value: unknown, max = 255) {
  if (value === undefined || value === null || value === '') return null;
  return text(value, max);
}

function nonNegativeNumber(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function courseInput(body: Record<string, unknown>, partial = false) {
  const result: Record<string, unknown> = {};
  if (!partial || 'title' in body) {
    const title = text(body.title);
    if (!title) return null;
    result.title = title;
  }
  if (!partial || 'categoryName' in body) {
    const categoryName = optionalText(body.categoryName, 150);
    if (body.categoryName && !categoryName) return null;
    result.categoryName = categoryName;
  }
  for (const key of ['summary', 'details', 'instructorName', 'thumbnailUrl'] as const) {
    if (!partial || key in body) {
      const value = optionalText(body[key], key === 'thumbnailUrl' ? 2048 : 4000);
      if (body[key] && !value) return null;
      result[key] = value;
    }
  }
  for (const key of ['durationMinutes', 'cpeCredits', 'price'] as const) {
    if (!partial || key in body) {
      const fallback = key === 'price' || key === 'cpeCredits' || key === 'durationMinutes' ? 0 : 0;
      const value = nonNegativeNumber(body[key], fallback);
      if (value === null || (key === 'durationMinutes' && !Number.isInteger(value))) return null;
      result[key] = value;
    }
  }
  if (!partial || 'maxStudents' in body) {
    const maxStudents = body.maxStudents === null || body.maxStudents === '' || body.maxStudents === undefined
      ? null
      : positiveInteger(body.maxStudents);
    if (body.maxStudents && !maxStudents) return null;
    result.maxStudents = maxStudents;
  }
  if (!partial || 'enrollmentDeadline' in body) {
    const rawDeadline = optionalText(body.enrollmentDeadline, 80);
    const deadline = rawDeadline ? new Date(rawDeadline) : null;
    if (rawDeadline && (!deadline || Number.isNaN(deadline.getTime()))) return null;
    result.enrollmentDeadline = deadline;
  }
  if (!partial || 'status' in body) {
    const status = body.status ?? (partial ? undefined : 'draft');
    if (status !== undefined && !['draft', 'published', 'archived'].includes(String(status))) return null;
    if (status !== undefined) result.status = status;
  }
  return result;
}

async function categoryIdFor(name: string | null, executor: typeof db | any = db): Promise<number | null> {
  if (!name) return null;
  const rows = await executor.insert(academyCategories)
    .values({ name, isActive: true })
    .onConflictDoUpdate({ target: academyCategories.name, set: { isActive: true } })
    .returning({ id: academyCategories.id });
  return rows[0]?.id ?? null;
}

async function syncLearner(request: FastifyRequest, executor: typeof db | any = db) {
  const identity = getPharmacyAssertionIdentity(request);
  const displayName = `${identity.firstName} ${identity.lastName}`.trim();
  const rows = await executor.insert(academyLearners).values({
    pharmacySubject: identity.subject,
    pharmacistLicense: identity.pharmacistLicense,
    displayName,
    email: identity.email,
  }).onConflictDoUpdate({
    target: academyLearners.pharmacySubject,
    set: {
      pharmacistLicense: identity.pharmacistLicense,
      displayName,
      email: identity.email,
      updatedAt: new Date(),
    },
  }).returning();
  return rows[0];
}

async function lockOpenCourse(executor: typeof db | any, courseId: number) {
  const rows = await executor.select().from(academyCourses)
    .where(eq(academyCourses.id, courseId)).for('update').limit(1);
  const course = rows[0];
  if (!course || course.status !== 'published') return { error: 'ไม่พบคอร์สที่เปิดรับสมัคร', statusCode: 404 } as const;
  if (course.enrollmentDeadline && new Date(course.enrollmentDeadline).getTime() < Date.now()) {
    return { error: 'คอร์สปิดรับสมัครแล้ว', statusCode: 409 } as const;
  }
  if (course.maxStudents) {
    const [row] = await executor.select({ total: count() }).from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, courseId), eq(academyEnrollments.status, 'active')));
    if (Number(row?.total ?? 0) >= course.maxStudents) return { error: 'คอร์สมีผู้ลงทะเบียนครบแล้ว', statusCode: 409 } as const;
  }
  return { course } as const;
}

async function createEnrollment(executor: typeof db | any, learnerId: number, courseId: number, sourceOrderId: number | null) {
  const rows = await executor.insert(academyEnrollments).values({
    learnerId,
    courseId,
    sourceOrderId,
    status: 'active',
  }).onConflictDoNothing().returning();
  if (rows[0]) return rows[0];
  const [existing] = await executor.select().from(academyEnrollments).where(and(
    eq(academyEnrollments.learnerId, learnerId),
    eq(academyEnrollments.courseId, courseId),
  )).limit(1);
  return existing;
}

export async function academyRoutes(app: FastifyInstance) {
  app.get('/academy/categories', async () => {
    return db.select({
      id: academyCategories.id,
      name: academyCategories.name,
      count: count(academyCourses.id),
    }).from(academyCategories)
      .innerJoin(academyCourses, eq(academyCourses.categoryId, academyCategories.id))
      .where(and(eq(academyCategories.isActive, true), eq(academyCourses.status, 'published')))
      .groupBy(academyCategories.id, academyCategories.name)
      .orderBy(asc(academyCategories.name));
  });

  app.get('/academy/courses', async (request) => {
    const query = request.query as Record<string, unknown>;
    const { page, limit, offset } = paging(query);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const categoryId = Number.parseInt(String(query.categoryId ?? ''), 10);
    const filters = [eq(academyCourses.status, 'published')];
    if (Number.isInteger(categoryId) && categoryId > 0) filters.push(eq(academyCourses.categoryId, categoryId));
    if (search) filters.push(or(
      ilike(academyCourses.title, `%${search}%`),
      ilike(academyCourses.summary, `%${search}%`),
      ilike(academyCourses.instructorName, `%${search}%`),
      ilike(academyCategories.name, `%${search}%`),
    )!);
    const where = and(...filters);
    const [items, [totalRow]] = await Promise.all([
      db.select({
        id: academyCourses.id,
        title: academyCourses.title,
        summary: academyCourses.summary,
        instructorName: academyCourses.instructorName,
        thumbnailUrl: academyCourses.thumbnailUrl,
        durationMinutes: academyCourses.durationMinutes,
        cpeCredits: academyCourses.cpeCredits,
        price: academyCourses.price,
        categoryId: academyCategories.id,
        categoryName: academyCategories.name,
      }).from(academyCourses)
        .leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id))
        .where(where).orderBy(desc(academyCourses.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(academyCourses)
        .leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id)).where(where),
    ]);
    return { items, page, limit, total: Number(totalRow?.total ?? 0) };
  });

  app.get('/academy/courses/:id', async (request, reply) => {
    const id = Number.parseInt((request.params as { id: string }).id, 10);
    const [course] = await db.select({
      id: academyCourses.id,
      title: academyCourses.title,
      summary: academyCourses.summary,
      details: academyCourses.details,
      instructorName: academyCourses.instructorName,
      thumbnailUrl: academyCourses.thumbnailUrl,
      durationMinutes: academyCourses.durationMinutes,
      cpeCredits: academyCourses.cpeCredits,
      price: academyCourses.price,
      enrollmentDeadline: academyCourses.enrollmentDeadline,
      maxStudents: academyCourses.maxStudents,
      categoryId: academyCategories.id,
      categoryName: academyCategories.name,
    }).from(academyCourses)
      .leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id))
      .where(and(eq(academyCourses.id, id), eq(academyCourses.status, 'published'))).limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์สที่เปิดเผย' });
    return course;
  });

  app.get('/academy/me/enrollments', { preHandler: [verifyPharmacyAssertion] }, async (request) => {
    const identity = getPharmacyAssertionIdentity(request);
    return db.select({
      courseId: academyCourses.id,
      enrollmentId: academyEnrollments.id,
      status: academyEnrollments.status,
      enrolledAt: academyEnrollments.enrolledAt,
    }).from(academyEnrollments)
      .innerJoin(academyLearners, eq(academyLearners.id, academyEnrollments.learnerId))
      .innerJoin(academyCourses, eq(academyCourses.id, academyEnrollments.courseId))
      .where(and(eq(academyLearners.pharmacySubject, identity.subject), eq(academyEnrollments.status, 'active')));
  });

  app.get('/academy/orders/:id', { preHandler: [verifyPharmacyAssertion] }, async (request, reply) => {
    const orderId = Number.parseInt((request.params as { id: string }).id, 10);
    const identity = getPharmacyAssertionIdentity(request);
    const [order] = await db.select({
      id: academyOrders.id,
      courseId: academyCourses.id,
      courseTitle: academyCourses.title,
      amountSnapshot: academyOrders.amountSnapshot,
      status: academyOrders.status,
    }).from(academyOrders)
      .innerJoin(academyLearners, eq(academyLearners.id, academyOrders.learnerId))
      .innerJoin(academyCourses, eq(academyCourses.id, academyOrders.courseId))
      .where(and(eq(academyOrders.id, orderId), eq(academyLearners.pharmacySubject, identity.subject))).limit(1);
    if (!order) return reply.status(404).send({ message: 'ไม่พบคำสั่งซื้อ' });
    return order;
  });

  app.post('/academy/courses/:id/orders', { preHandler: [verifyPharmacyAssertion] }, async (request, reply) => {
    const courseId = Number.parseInt((request.params as { id: string }).id, 10);
    if (!Number.isInteger(courseId) || courseId < 1) return reply.status(400).send({ message: 'รหัสคอร์สไม่ถูกต้อง' });
    const learner = await syncLearner(request);
    const [existingEnrollment] = await db.select().from(academyEnrollments).where(and(
      eq(academyEnrollments.learnerId, learner.id),
      eq(academyEnrollments.courseId, courseId),
    )).limit(1);
    if (existingEnrollment?.status === 'active') return { type: 'enrolled', enrollment: existingEnrollment };

    const result = await db.transaction(async (tx) => {
      const availability = await lockOpenCourse(tx, courseId);
      if ('error' in availability) return availability;
      const course = availability.course;
      const price = Number(course.price ?? 0);
      if (price === 0) {
        const enrollment = await createEnrollment(tx, learner.id, courseId, null);
        return { type: 'enrolled' as const, enrollment };
      }
      const [prior] = await tx.select().from(academyOrders).where(and(
        eq(academyOrders.learnerId, learner.id),
        eq(academyOrders.courseId, courseId),
        eq(academyOrders.status, 'pending'),
      )).limit(1);
      if (prior) return { type: 'payment_required' as const, order: prior };
      const [order] = await tx.insert(academyOrders).values({
        learnerId: learner.id,
        courseId,
        amountSnapshot: String(price),
        status: 'pending',
      }).onConflictDoNothing().returning();
      if (order) return { type: 'payment_required' as const, order };
      const [concurrentOrder] = await tx.select().from(academyOrders).where(and(
        eq(academyOrders.learnerId, learner.id),
        eq(academyOrders.courseId, courseId),
        eq(academyOrders.status, 'pending'),
      )).limit(1);
      return concurrentOrder
        ? { type: 'payment_required' as const, order: concurrentOrder }
        : { error: 'ไม่สามารถสร้างคำสั่งซื้อได้', statusCode: 409 } as const;
    });
    if ('error' in result) return reply.status(result.statusCode ?? 409).send({ message: result.error });
    return result;
  });

  app.post('/academy/orders/:id/mock-complete', { preHandler: [verifyPharmacyAssertion] }, async (request, reply) => {
    const mockEnabled = process.env.NODE_ENV === 'production'
      ? process.env.ACADEMY_MOCK_PAYMENTS_ENABLED === 'true'
      : process.env.ACADEMY_MOCK_PAYMENTS_ENABLED !== 'false';
    if (!mockEnabled) return reply.status(404).send({ message: 'ไม่พบรายการที่ต้องการ' });
    const orderId = Number.parseInt((request.params as { id: string }).id, 10);
    const identity = getPharmacyAssertionIdentity(request);
    const [learner] = await db.select().from(academyLearners)
      .where(eq(academyLearners.pharmacySubject, identity.subject)).limit(1);
    if (!learner) return reply.status(404).send({ message: 'ไม่พบผู้ลงทะเบียน' });
    const [order] = await db.select().from(academyOrders).where(and(
      eq(academyOrders.id, orderId), eq(academyOrders.learnerId, learner.id),
    )).limit(1);
    if (!order) return reply.status(404).send({ message: 'ไม่พบคำสั่งซื้อ' });
    if (order.status === 'mock_paid') {
      const enrollment = await createEnrollment(db, learner.id, order.courseId, order.id);
      return { status: 'mock_paid', enrollment };
    }
    if (order.status !== 'pending') return reply.status(409).send({ message: 'คำสั่งซื้อนี้ไม่อยู่ในสถานะรอชำระเงิน' });

    const result = await db.transaction(async (tx) => {
      const [course] = await tx.select().from(academyCourses)
        .where(eq(academyCourses.id, order.courseId)).for('update').limit(1);
      if (!course || course.status !== 'published') return { error: 'ไม่พบคอร์สที่เปิดรับสมัคร', statusCode: 404 } as const;
      if (course.enrollmentDeadline && new Date(course.enrollmentDeadline).getTime() < Date.now()) {
        return { error: 'คอร์สปิดรับสมัครแล้ว', statusCode: 409 } as const;
      }
      const [currentOrder] = await tx.select().from(academyOrders)
        .where(eq(academyOrders.id, order.id)).for('update').limit(1);
      if (currentOrder?.status === 'mock_paid') {
        return { status: 'mock_paid' as const, enrollment: await createEnrollment(tx, learner.id, order.courseId, order.id) };
      }
      if (currentOrder?.status !== 'pending') return { error: 'คำสั่งซื้อเปลี่ยนสถานะแล้ว', statusCode: 409 } as const;
      if (course.maxStudents) {
        const [enrolled] = await tx.select({ total: count() }).from(academyEnrollments)
          .where(and(eq(academyEnrollments.courseId, order.courseId), eq(academyEnrollments.status, 'active')));
        if (Number(enrolled?.total ?? 0) >= course.maxStudents) return { error: 'คอร์สมีผู้ลงทะเบียนครบแล้ว', statusCode: 409 } as const;
      }
      const [updatedOrder] = await tx.update(academyOrders).set({
        status: 'mock_paid',
        updatedAt: new Date(),
      }).where(and(eq(academyOrders.id, order.id), eq(academyOrders.status, 'pending'))).returning();
      if (!updatedOrder) {
        const [current] = await tx.select().from(academyOrders).where(eq(academyOrders.id, order.id)).limit(1);
        if (current?.status === 'mock_paid') {
          return { status: 'mock_paid' as const, enrollment: await createEnrollment(tx, learner.id, order.courseId, order.id) };
        }
        return { error: 'คำสั่งซื้อเปลี่ยนสถานะแล้ว', statusCode: 409 } as const;
      }
      const enrollment = await createEnrollment(tx, learner.id, order.courseId, order.id);
      return { status: 'mock_paid' as const, enrollment };
    });
    if ('error' in result) return reply.status(result.statusCode ?? 409).send({ message: result.error });
    return result;
  });

  app.get('/academy/admin/courses', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const { page, limit, offset } = paging(query);
    const status = ['draft', 'published', 'archived'].includes(String(query.status)) ? String(query.status) as 'draft' | 'published' | 'archived' : null;
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const filters = [];
    if (status) filters.push(eq(academyCourses.status, status));
    if (search) filters.push(or(ilike(academyCourses.title, `%${search}%`), ilike(academyCourses.instructorName, `%${search}%`))!);
    const where = filters.length ? and(...filters) : undefined;
    const [items, [totalRow]] = await Promise.all([
      db.select({
        id: academyCourses.id,
        title: academyCourses.title,
        summary: academyCourses.summary,
        instructorName: academyCourses.instructorName,
        durationMinutes: academyCourses.durationMinutes,
        cpeCredits: academyCourses.cpeCredits,
        price: academyCourses.price,
        status: academyCourses.status,
        createdAt: academyCourses.createdAt,
        categoryId: academyCategories.id,
        categoryName: academyCategories.name,
      }).from(academyCourses).leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id))
        .where(where).orderBy(desc(academyCourses.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(academyCourses).where(where),
    ]);
    return { items, page, limit, total: Number(totalRow?.total ?? 0) };
  });

  app.get('/academy/admin/courses/:id', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (request, reply) => {
    const id = Number.parseInt((request.params as { id: string }).id, 10);
    const [course] = await db.select({
      id: academyCourses.id,
      title: academyCourses.title,
      summary: academyCourses.summary,
      details: academyCourses.details,
      instructorName: academyCourses.instructorName,
      thumbnailUrl: academyCourses.thumbnailUrl,
      durationMinutes: academyCourses.durationMinutes,
      cpeCredits: academyCourses.cpeCredits,
      price: academyCourses.price,
      maxStudents: academyCourses.maxStudents,
      enrollmentDeadline: academyCourses.enrollmentDeadline,
      status: academyCourses.status,
      categoryId: academyCategories.id,
      categoryName: academyCategories.name,
    }).from(academyCourses).leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id))
      .where(eq(academyCourses.id, id)).limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    return course;
  });

  app.post('/academy/admin/courses', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (request, reply) => {
    const input = courseInput((request.body ?? {}) as Record<string, unknown>);
    if (!input) return reply.status(400).send({ message: 'กรุณาตรวจสอบข้อมูลคอร์ส' });
    const categoryId = await categoryIdFor(input.categoryName as string | null);
    const { categoryName: _categoryName, ...values } = input;
    const [course] = await db.insert(academyCourses).values({ ...values, categoryId } as typeof academyCourses.$inferInsert).returning();
    return reply.status(201).send(course);
  });

  app.patch('/academy/admin/courses/:id', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (request, reply) => {
    const id = Number.parseInt((request.params as { id: string }).id, 10);
    const input = courseInput((request.body ?? {}) as Record<string, unknown>, true);
    if (!input || Object.keys(input).length === 0) return reply.status(400).send({ message: 'กรุณาตรวจสอบข้อมูลคอร์ส' });
    const current = await db.select({ id: academyCourses.id, categoryId: academyCourses.categoryId })
      .from(academyCourses).where(eq(academyCourses.id, id)).limit(1);
    if (!current[0]) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    let categoryId = current[0].categoryId;
    if ('categoryName' in input) categoryId = await categoryIdFor(input.categoryName as string | null);
    const { categoryName: _categoryName, ...values } = input;
    const [course] = await db.update(academyCourses).set({
      ...values,
      categoryId,
      updatedAt: new Date(),
    } as Partial<typeof academyCourses.$inferInsert>).where(eq(academyCourses.id, id)).returning();
    return course;
  });

  app.get('/academy/admin/courses/:id/enrollments', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (request, reply) => {
    const courseId = Number.parseInt((request.params as { id: string }).id, 10);
    const query = request.query as Record<string, unknown>;
    const { page, limit, offset } = paging(query);
    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const filters = [eq(academyEnrollments.courseId, courseId), eq(academyEnrollments.status, 'active')];
    if (search) filters.push(or(ilike(academyLearners.displayName, `%${search}%`), ilike(academyLearners.pharmacistLicense, `%${search}%`))!);
    const where = and(...filters);
    const [items, [totalRow]] = await Promise.all([
      db.select({
        id: academyEnrollments.id,
        displayName: academyLearners.displayName,
        pharmacistLicense: academyLearners.pharmacistLicense,
        email: academyLearners.email,
        enrolledAt: academyEnrollments.enrolledAt,
        orderStatus: academyOrders.status,
      }).from(academyEnrollments)
        .innerJoin(academyLearners, eq(academyLearners.id, academyEnrollments.learnerId))
        .leftJoin(academyOrders, eq(academyOrders.id, academyEnrollments.sourceOrderId))
        .where(where).orderBy(desc(academyEnrollments.enrolledAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(academyEnrollments)
        .innerJoin(academyLearners, eq(academyLearners.id, academyEnrollments.learnerId)).where(where),
    ]);
    const [course] = await db.select({ id: academyCourses.id, title: academyCourses.title }).from(academyCourses)
      .where(eq(academyCourses.id, courseId)).limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    return { course, items, page, limit, total: Number(totalRow?.total ?? 0) };
  });
}

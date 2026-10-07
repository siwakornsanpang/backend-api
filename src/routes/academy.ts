import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, desc, eq, ilike, inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { db } from '../db';
import {
  academyCategories,
  academyCourseOutcomes,
  academyCourses,
  academyCertificates,
  academyEnrollments,
  academyInstructors,
  academyOrders,
  academyRefundRequests,
  academyLessonDocuments,
  academyLessonProgress,
  academyLessons,
  academyReviews,
} from '../db/schema';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { getPharmacyAssertionIdentity, verifyPharmacyAssertion } from '../utils/pharmacyAssertion';
import { streamToBuffer, uploadToStorage, deleteFromStorage } from '../utils/upload';

const admin = [verifyToken, requirePermission('manage_product')];

function cpeLabel(value: string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0 หน่วยกิต';
  return `${n} หน่วยกิต`;
}

function listQuery(query: { page?: string; pageSize?: string; q?: string; status?: string }, allowedStatus: string[]) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(Number(query.pageSize) || 20)));
  const q = String(query.q || '').trim().slice(0, 80);
  const status = allowedStatus.includes(String(query.status || '')) ? String(query.status) : '';
  return { page, pageSize, q, status, offset: (page - 1) * pageSize };
}

function listWhere(q: string, status: string, statusColumn: AnyColumn, columns: AnyColumn[]) {
  const filters: SQL[] = [];
  if (status) filters.push(eq(statusColumn, status));
  if (q) filters.push(or(...columns.map((column) => ilike(column, `%${q}%`)))!);
  return filters.length ? and(...filters) : undefined;
}

function numericText(value: unknown, fallback = '0') {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : fallback;
}

type QuizQuestion = { question: string; options: string[]; answer: string };

function parseQuiz(text: string): QuizQuestion[] {
  return text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).flatMap((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const options = lines.slice(1).map((line) => line.replace(/^-\s*/, '').replace(/\*$/, '').trim());
    const marked = lines.slice(1).find((line) => line.endsWith('*'));
    const answer = marked ? marked.replace(/^-\s*/, '').replace(/\*$/, '').trim() : options[0];
    return [{ question: lines[0], options, answer }];
  });
}

function formatQuiz(quiz: unknown) {
  if (!Array.isArray(quiz)) return '';
  return quiz.map((item) => {
    const question = item as QuizQuestion;
    const options = (question.options || []).map((option) => `- ${option}${option === question.answer ? '*' : ''}`);
    return [question.question, ...options].join('\n');
  }).join('\n\n');
}

type DocumentInput = { id?: number; name?: string; fileUrl?: string };
type LessonInput = { id?: number; title?: string; description?: string; videoUrl?: string; quizText?: string; documents?: DocumentInput[] };

async function syncDocuments(lessonId: number, documents: DocumentInput[]) {
  const existing = await db.select().from(academyLessonDocuments).where(eq(academyLessonDocuments.lessonId, lessonId));
  const keep = new Set<number>();
  for (const [index, document] of documents.entries()) {
    const name = document.name?.trim();
    const fileUrl = document.fileUrl?.trim();
    if (!name || !fileUrl) continue;
    const currentId = Number(document.id);
    if (currentId && existing.some((row) => row.id === currentId)) {
      keep.add(currentId);
      await db.update(academyLessonDocuments).set({ name, fileUrl, sortOrder: index }).where(eq(academyLessonDocuments.id, currentId));
    } else {
      const [created] = await db.insert(academyLessonDocuments).values({ lessonId, name, fileUrl, sortOrder: index }).returning();
      keep.add(created.id);
    }
  }
  const removed = existing.filter((row) => !keep.has(row.id));
  if (removed.length) {
    deleteFromStorage(removed.map((row) => row.fileUrl));
    await db.delete(academyLessonDocuments).where(inArray(academyLessonDocuments.id, removed.map((row) => row.id)));
  }
}

async function syncLessons(courseId: number, lessons: LessonInput[]) {
  const existing = await db.select().from(academyLessons).where(eq(academyLessons.courseId, courseId));
  const keep = new Set<number>();
  const saved: { id: number; documents: DocumentInput[] }[] = [];
  for (const [index, lesson] of lessons.entries()) {
    const title = lesson.title?.trim();
    if (!title) continue;
    const values = {
      title,
      description: lesson.description?.trim() || null,
      videoUrl: lesson.videoUrl?.trim() || null,
      sortOrder: index,
      quiz: parseQuiz(lesson.quizText || ''),
    };
    const currentId = Number(lesson.id);
    let lessonId = currentId;
    if (currentId && existing.some((row) => row.id === currentId)) {
      keep.add(currentId);
      await db.update(academyLessons).set(values).where(eq(academyLessons.id, currentId));
    } else {
      const [created] = await db.insert(academyLessons).values({ courseId, ...values }).returning();
      lessonId = created.id;
      keep.add(created.id);
    }
    saved.push({ id: lessonId, documents: lesson.documents || [] });
  }
  const removed = existing.filter((row) => !keep.has(row.id));
  if (removed.length) {
    const docs = await db.select().from(academyLessonDocuments).where(inArray(academyLessonDocuments.lessonId, removed.map((row) => row.id)));
    deleteFromStorage(docs.map((row) => row.fileUrl));
    await db.delete(academyLessons).where(inArray(academyLessons.id, removed.map((row) => row.id)));
  }
  for (const lesson of saved) await syncDocuments(lesson.id, lesson.documents);
}

async function refreshProgress(enrollmentId: number, courseId: number, license: string) {
  const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, courseId)).limit(1);
  const [enrollment] = await db.select().from(academyEnrollments).where(eq(academyEnrollments.id, enrollmentId)).limit(1);
  const lessons = await db.select().from(academyLessons).where(eq(academyLessons.courseId, courseId));
  const doneRows = await db.select().from(academyLessonProgress)
    .where(and(eq(academyLessonProgress.pharmacistLicense, license), eq(academyLessonProgress.isCompleted, true)));
  const doneIds = new Set(doneRows.map((item) => item.lessonId));
  const finished = lessons.filter((item) => doneIds.has(item.id)).length;
  const hasExam = Array.isArray(course?.exam) && course.exam.length > 0;
  const lessonRatio = lessons.length ? finished / lessons.length : 1;
  const percent = hasExam
    ? (enrollment?.examPassed ? 100 : Math.round(lessonRatio * 80))
    : Math.round(lessonRatio * 100);
  await db.update(academyEnrollments).set({ progressPercent: String(percent) }).where(eq(academyEnrollments.id, enrollmentId));
  return { percent, lessonsDone: lessons.length === 0 || finished === lessons.length, hasExam };
}

async function enrollmentCounts() {
  const rows = await db
    .select({
      courseId: academyEnrollments.courseId,
      total: sql<string>`count(${academyEnrollments.id})`,
    })
    .from(academyEnrollments)
    .where(eq(academyEnrollments.status, 'active'))
    .groupBy(academyEnrollments.courseId);
  return new Map(rows.map((row) => [row.courseId, Number(row.total)]));
}

function courseMode(value: unknown, fallback: 'online' | 'onsite' = 'online') {
  if (value === 'onsite' || value === 'online') return value;
  return fallback;
}

function dateOrNull(value: unknown) {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function placeOf(course: { format: string; venue: string | null; trainingStartsAt: Date | null; trainingEndsAt: Date | null }) {
  return {
    format: course.format === 'onsite' ? 'onsite' : 'online',
    venue: course.venue,
    trainingStartsAt: course.trainingStartsAt,
    trainingEndsAt: course.trainingEndsAt,
  };
}

function bridgeOk(headers: { [key: string]: string | string[] | undefined }) {
  const key = process.env.ACADEMY_BRIDGE_KEY;
  return Boolean(key) && headers['x-academy-bridge'] === key;
}

async function verifyMemberRequest(request: FastifyRequest, reply: FastifyReply) {
  if (bridgeOk(request.headers)) return;
  return verifyPharmacyAssertion(request, reply);
}

function memberLicense(request: FastifyRequest, supplied?: string) {
  return bridgeOk(request.headers)
    ? supplied?.trim() || ''
    : getPharmacyAssertionIdentity(request).pharmacistLicense;
}

function memberName(request: FastifyRequest, supplied?: string) {
  if (bridgeOk(request.headers)) return supplied?.trim() || '';
  const identity = getPharmacyAssertionIdentity(request);
  return `${identity.firstName} ${identity.lastName}`.trim() || identity.pharmacistLicense;
}

async function reviewStats() {
  const rows = await db
    .select({
      courseId: academyReviews.courseId,
      avg: sql<string>`avg(${academyReviews.rating})`,
      total: sql<string>`count(${academyReviews.id})`,
    })
    .from(academyReviews)
    .groupBy(academyReviews.courseId);
  const map = new Map<number, { rating: number | null; reviewCount: number }>();
  for (const row of rows) {
    map.set(row.courseId, {
      rating: row.avg == null ? null : Math.round(Number(row.avg) * 10) / 10,
      reviewCount: Number(row.total),
    });
  }
  return map;
}

async function outcomesByCourse(courseIds: number[]) {
  if (courseIds.length === 0) return new Map<number, string[]>();
  const rows = await db
    .select()
    .from(academyCourseOutcomes)
    .orderBy(asc(academyCourseOutcomes.sortOrder), asc(academyCourseOutcomes.id));
  const map = new Map<number, string[]>();
  for (const row of rows) {
    if (!courseIds.includes(row.courseId)) continue;
    const list = map.get(row.courseId) ?? [];
    list.push(row.text);
    map.set(row.courseId, list);
  }
  return map;
}

export async function academyRoutes(app: FastifyInstance) {
  app.post('/academy/admin/upload', { preHandler: admin }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ message: 'ไม่พบไฟล์' });
    const buffer = await streamToBuffer(data.file);
    const url = await uploadToStorage('academy', buffer, data.filename, data.mimetype);
    if (!url) return reply.status(500).send({ message: 'อัปโหลดไม่สำเร็จ' });
    return { url };
  });

  app.get('/academy/categories', async () => {
    const categories = await db
      .select()
      .from(academyCategories)
      .where(eq(academyCategories.isVisible, true))
      .orderBy(asc(academyCategories.sortOrder), asc(academyCategories.id));
    const counts = await db
      .select({
        categoryId: academyCourses.categoryId,
        total: sql<string>`count(${academyCourses.id})`,
      })
      .from(academyCourses)
      .where(eq(academyCourses.status, 'published'))
      .groupBy(academyCourses.categoryId);
    const countMap = new Map(counts.map((row) => [row.categoryId, Number(row.total)]));
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      imageUrl: category.imageUrl,
      color: category.color,
      courseCount: countMap.get(category.id) ?? 0,
    }));
  });

  app.get('/academy/admin/categories', { preHandler: admin }, async () => {
    return db.select().from(academyCategories).orderBy(asc(academyCategories.sortOrder), asc(academyCategories.id));
  });

  app.post('/academy/admin/categories', { preHandler: admin }, async (req, reply) => {
    const body = req.body as {
      name?: string;
      description?: string;
      imageUrl?: string;
      color?: string;
      sortOrder?: number;
      isVisible?: boolean;
    };
    if (!body.name?.trim()) return reply.status(400).send({ message: 'กรุณาระบุชื่อหมวดหมู่' });
    const [created] = await db.insert(academyCategories).values({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      imageUrl: body.imageUrl || null,
      color: body.color || '#737300',
      sortOrder: body.sortOrder ?? 0,
      isVisible: body.isVisible ?? true,
    }).returning();
    return { success: true, data: created };
  });

  app.put('/academy/admin/categories/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      description?: string;
      imageUrl?: string | null;
      color?: string;
      sortOrder?: number;
      isVisible?: boolean;
    };
    const [existing] = await db.select().from(academyCategories).where(eq(academyCategories.id, Number(id))).limit(1);
    if (!existing) return reply.status(404).send({ message: 'ไม่พบหมวดหมู่' });
    if (body.imageUrl === null && existing.imageUrl) deleteFromStorage([existing.imageUrl]);
    const [updated] = await db.update(academyCategories).set({
      name: body.name?.trim() || existing.name,
      description: body.description !== undefined ? body.description : existing.description,
      imageUrl: body.imageUrl !== undefined ? body.imageUrl : existing.imageUrl,
      color: body.color || existing.color,
      sortOrder: body.sortOrder ?? existing.sortOrder,
      isVisible: body.isVisible ?? existing.isVisible,
      updatedAt: new Date(),
    }).where(eq(academyCategories.id, existing.id)).returning();
    return { success: true, data: updated };
  });

  app.delete('/academy/admin/categories/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(academyCategories).where(eq(academyCategories.id, Number(id))).limit(1);
    if (!existing) return reply.status(404).send({ message: 'ไม่พบหมวดหมู่' });
    if (existing.imageUrl) deleteFromStorage([existing.imageUrl]);
    await db.delete(academyCategories).where(eq(academyCategories.id, existing.id));
    return { success: true };
  });

  app.get('/academy/instructors', async () => {
    const rows = await db
      .select()
      .from(academyInstructors)
      .where(eq(academyInstructors.isVisible, true))
      .orderBy(asc(academyInstructors.sortOrder), asc(academyInstructors.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      expertise: row.expertise,
      imageUrl: row.imageUrl,
    }));
  });

  app.get('/academy/admin/instructors', { preHandler: admin }, async () => {
    return db.select().from(academyInstructors).orderBy(asc(academyInstructors.sortOrder), asc(academyInstructors.id));
  });

  app.post('/academy/admin/instructors', { preHandler: admin }, async (req, reply) => {
    const body = req.body as {
      name?: string;
      title?: string;
      expertise?: string;
      imageUrl?: string;
      sortOrder?: number;
      isVisible?: boolean;
    };
    if (!body.name?.trim()) return reply.status(400).send({ message: 'กรุณาระบุชื่อวิทยากร' });
    const [created] = await db.insert(academyInstructors).values({
      name: body.name.trim(),
      title: body.title?.trim() || null,
      expertise: body.expertise?.trim() || null,
      imageUrl: body.imageUrl || null,
      sortOrder: body.sortOrder ?? 0,
      isVisible: body.isVisible ?? true,
    }).returning();
    return { success: true, data: created };
  });

  app.put('/academy/admin/instructors/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string;
      title?: string;
      expertise?: string;
      imageUrl?: string | null;
      sortOrder?: number;
      isVisible?: boolean;
    };
    const [existing] = await db.select().from(academyInstructors).where(eq(academyInstructors.id, Number(id))).limit(1);
    if (!existing) return reply.status(404).send({ message: 'ไม่พบวิทยากร' });
    if (body.imageUrl === null && existing.imageUrl) deleteFromStorage([existing.imageUrl]);
    const [updated] = await db.update(academyInstructors).set({
      name: body.name?.trim() || existing.name,
      title: body.title !== undefined ? body.title : existing.title,
      expertise: body.expertise !== undefined ? body.expertise : existing.expertise,
      imageUrl: body.imageUrl !== undefined ? body.imageUrl : existing.imageUrl,
      sortOrder: body.sortOrder ?? existing.sortOrder,
      isVisible: body.isVisible ?? existing.isVisible,
      updatedAt: new Date(),
    }).where(eq(academyInstructors.id, existing.id)).returning();
    return { success: true, data: updated };
  });

  app.delete('/academy/admin/instructors/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(academyInstructors).where(eq(academyInstructors.id, Number(id))).limit(1);
    if (!existing) return reply.status(404).send({ message: 'ไม่พบวิทยากร' });
    if (existing.imageUrl) deleteFromStorage([existing.imageUrl]);
    await db.delete(academyInstructors).where(eq(academyInstructors.id, existing.id));
    return { success: true };
  });

  app.get('/academy/courses', async (req) => {
    const { category, q, featured } = req.query as { category?: string; q?: string; featured?: string };
    const conditions = [eq(academyCourses.status, 'published')];
    if (q?.trim()) {
      const search = `%${q.trim()}%`;
      conditions.push(or(
        ilike(academyCourses.title, search),
        ilike(academyCourses.summary, search),
        ilike(academyCategories.name, search),
        ilike(academyInstructors.name, search),
      )!);
    }
    if (featured === '1') conditions.push(eq(academyCourses.isFeatured, true));

    const rows = await db
      .select({
        course: academyCourses,
        categoryName: academyCategories.name,
        categoryColor: academyCategories.color,
        instructorName: academyInstructors.name,
        instructorTitle: academyInstructors.title,
      })
      .from(academyCourses)
      .leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id))
      .leftJoin(academyInstructors, eq(academyCourses.instructorId, academyInstructors.id))
      .where(and(...conditions))
      .orderBy(asc(academyCourses.popularOrder), desc(academyCourses.publishedAt));

    const filtered = category && category !== 'ทั้งหมด'
      ? rows.filter((row) => row.categoryName === category)
      : rows;
    const stats = await reviewStats();
    const learners = await enrollmentCounts();
    const outcomeMap = featured === '1'
      ? await outcomesByCourse(filtered.map((row) => row.course.id))
      : new Map<number, string[]>();

    return filtered.map((row) => ({
      id: row.course.id,
      title: row.course.title,
      summary: row.course.summary,
      categoryId: row.course.categoryId,
      coverUrl: row.course.coverUrl,
      durationLabel: row.course.durationLabel,
      cpeLabel: cpeLabel(row.course.cpeCredits),
      cpeCredits: row.course.cpeCredits,
      price: row.course.price,
      categoryName: row.categoryName,
      categoryColor: row.categoryColor,
      instructorName: row.instructorName,
      instructorTitle: row.instructorTitle,
      studentCount: learners.get(row.course.id) ?? 0,
      rating: stats.get(row.course.id)?.rating ?? null,
      reviewCount: stats.get(row.course.id)?.reviewCount ?? 0,
      outcomes: outcomeMap.get(row.course.id) ?? [],
      isFeatured: row.course.isFeatured,
      ...placeOf(row.course),
    }));
  });

  app.get('/academy/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select({
        course: academyCourses,
        categoryName: academyCategories.name,
        categoryColor: academyCategories.color,
        instructorName: academyInstructors.name,
        instructorTitle: academyInstructors.title,
        instructorExpertise: academyInstructors.expertise,
        instructorImageUrl: academyInstructors.imageUrl,
      })
      .from(academyCourses)
      .leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id))
      .leftJoin(academyInstructors, eq(academyCourses.instructorId, academyInstructors.id))
      .where(and(eq(academyCourses.id, Number(id)), eq(academyCourses.status, 'published')))
      .limit(1);
    if (!row) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    const outcomes = await db
      .select()
      .from(academyCourseOutcomes)
      .where(eq(academyCourseOutcomes.courseId, row.course.id))
      .orderBy(asc(academyCourseOutcomes.sortOrder), asc(academyCourseOutcomes.id));
    const stats = await reviewStats();
    const learners = await enrollmentCounts();
    const lessons = await db.select().from(academyLessons)
      .where(eq(academyLessons.courseId, row.course.id))
      .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.id));
    return {
      id: row.course.id,
      title: row.course.title,
      summary: row.course.summary,
      categoryId: row.course.categoryId,
      coverUrl: row.course.coverUrl,
      durationLabel: row.course.durationLabel,
      cpeLabel: cpeLabel(row.course.cpeCredits),
      cpeCredits: row.course.cpeCredits,
      conferenceCode: row.course.conferenceCode,
      price: row.course.price,
      audience: row.course.audience,
      categoryName: row.categoryName,
      categoryColor: row.categoryColor,
      instructorName: row.instructorName,
      instructorTitle: row.instructorTitle,
      instructorExpertise: row.instructorExpertise,
      instructorImageUrl: row.instructorImageUrl,
      studentCount: learners.get(row.course.id) ?? 0,
      rating: stats.get(row.course.id)?.rating ?? null,
      reviewCount: stats.get(row.course.id)?.reviewCount ?? 0,
      outcomes: outcomes.map((item) => item.text),
      ...placeOf(row.course),
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
      })),
    };
  });

  app.get('/academy/admin/courses', { preHandler: admin }, async () => {
    const rows = await db
      .select({
        course: academyCourses,
        categoryName: academyCategories.name,
        instructorName: academyInstructors.name,
      })
      .from(academyCourses)
      .leftJoin(academyCategories, eq(academyCourses.categoryId, academyCategories.id))
      .leftJoin(academyInstructors, eq(academyCourses.instructorId, academyInstructors.id))
      .orderBy(desc(academyCourses.updatedAt));
    return rows.map((row) => ({ ...row.course, categoryName: row.categoryName, instructorName: row.instructorName }));
  });

  app.get('/academy/admin/courses/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, Number(id))).limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    const outcomes = await db
      .select()
      .from(academyCourseOutcomes)
      .where(eq(academyCourseOutcomes.courseId, course.id))
      .orderBy(asc(academyCourseOutcomes.sortOrder), asc(academyCourseOutcomes.id));
    const lessons = await db.select().from(academyLessons)
      .where(eq(academyLessons.courseId, course.id))
      .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.id));
    const documents = lessons.length
      ? await db.select().from(academyLessonDocuments)
        .where(inArray(academyLessonDocuments.lessonId, lessons.map((lesson) => lesson.id)))
        .orderBy(asc(academyLessonDocuments.sortOrder), asc(academyLessonDocuments.id))
      : [];
    return {
      ...course,
      examText: formatQuiz(course.exam),
      outcomes: outcomes.map((item) => item.text),
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description || '',
        videoUrl: lesson.videoUrl || '',
        quizText: formatQuiz(lesson.quiz),
        documents: documents.filter((document) => document.lessonId === lesson.id).map((document) => ({
          id: document.id,
          name: document.name,
          fileUrl: document.fileUrl,
        })),
      })),
    };
  });

  app.post('/academy/admin/courses', { preHandler: admin }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const title = String(body.title ?? '').trim();
    if (!title) return reply.status(400).send({ message: 'กรุณาระบุชื่อคอร์ส' });
    const status = (body.status as 'draft' | 'published' | 'archived') || 'draft';
    const format = courseMode(body.format);
    const venue = String(body.venue ?? '').trim() || null;
    const trainingStartsAt = dateOrNull(body.trainingStartsAt);
    if (format === 'onsite' && (!venue || !trainingStartsAt)) {
      return reply.status(400).send({ message: 'คอร์สออนไซต์ต้องระบุสถานที่และวันอบรม' });
    }
    const [created] = await db.insert(academyCourses).values({
      title,
      summary: String(body.summary ?? '').trim() || null,
      coverUrl: (body.coverUrl as string) || null,
      durationLabel: String(body.durationLabel ?? '').trim() || null,
      cpeCredits: numericText(body.cpeCredits),
      conferenceCode: String(body.conferenceCode ?? '').trim() || null,
      price: numericText(body.price),
      audience: (body.audience as 'all' | 'general' | 'pharmacist') || 'all',
      format,
      venue,
      trainingStartsAt,
      trainingEndsAt: dateOrNull(body.trainingEndsAt),
      status,
      isFeatured: Boolean(body.isFeatured),
      popularOrder: Number(body.popularOrder ?? 0),
      exam: parseQuiz(String(body.examText ?? '')),
      categoryId: body.categoryId ? Number(body.categoryId) : null,
      instructorId: body.instructorId ? Number(body.instructorId) : null,
      publishedAt: status === 'published' ? new Date() : null,
    }).returning();
    const outcomes = Array.isArray(body.outcomes) ? body.outcomes.map(String).map((item) => item.trim()).filter(Boolean) : [];
    if (outcomes.length) {
      await db.insert(academyCourseOutcomes).values(outcomes.map((text, index) => ({
        courseId: created.id,
        text,
        sortOrder: index,
      })));
    }
    if (Array.isArray(body.lessons)) await syncLessons(created.id, body.lessons as LessonInput[]);
    return { success: true, data: created };
  });

  app.put('/academy/admin/courses/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const [existing] = await db.select().from(academyCourses).where(eq(academyCourses.id, Number(id))).limit(1);
    if (!existing) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    const status = (body.status as 'draft' | 'published' | 'archived') || existing.status;
    const format = body.format !== undefined ? courseMode(body.format) : courseMode(existing.format);
    const venue = body.venue !== undefined ? String(body.venue).trim() || null : existing.venue;
    const trainingStartsAt = body.trainingStartsAt !== undefined ? dateOrNull(body.trainingStartsAt) : existing.trainingStartsAt;
    const trainingEndsAt = body.trainingEndsAt !== undefined ? dateOrNull(body.trainingEndsAt) : existing.trainingEndsAt;
    if (format === 'onsite' && (!venue || !trainingStartsAt)) {
      return reply.status(400).send({ message: 'คอร์สออนไซต์ต้องระบุสถานที่และวันอบรม' });
    }
    if (body.coverUrl === null && existing.coverUrl) deleteFromStorage([existing.coverUrl]);
    const [updated] = await db.update(academyCourses).set({
      title: String(body.title ?? existing.title).trim() || existing.title,
      summary: body.summary !== undefined ? String(body.summary).trim() || null : existing.summary,
      coverUrl: body.coverUrl !== undefined ? (body.coverUrl as string | null) : existing.coverUrl,
      durationLabel: body.durationLabel !== undefined ? String(body.durationLabel).trim() || null : existing.durationLabel,
      cpeCredits: body.cpeCredits !== undefined ? numericText(body.cpeCredits, existing.cpeCredits || '0') : existing.cpeCredits,
      conferenceCode: body.conferenceCode !== undefined ? String(body.conferenceCode).trim() || null : existing.conferenceCode,
      price: body.price !== undefined ? numericText(body.price, existing.price) : existing.price,
      audience: (body.audience as typeof existing.audience) || existing.audience,
      format,
      venue,
      trainingStartsAt,
      trainingEndsAt,
      status,
      isFeatured: body.isFeatured !== undefined ? Boolean(body.isFeatured) : existing.isFeatured,
      popularOrder: body.popularOrder !== undefined ? Number(body.popularOrder) : existing.popularOrder,
      exam: body.examText !== undefined ? parseQuiz(String(body.examText)) : existing.exam,
      categoryId: body.categoryId !== undefined ? (body.categoryId ? Number(body.categoryId) : null) : existing.categoryId,
      instructorId: body.instructorId !== undefined ? (body.instructorId ? Number(body.instructorId) : null) : existing.instructorId,
      publishedAt: status === 'published' ? existing.publishedAt ?? new Date() : existing.publishedAt,
      updatedAt: new Date(),
    }).where(eq(academyCourses.id, existing.id)).returning();

    if (Array.isArray(body.outcomes)) {
      await db.delete(academyCourseOutcomes).where(eq(academyCourseOutcomes.courseId, existing.id));
      const outcomes = body.outcomes.map(String).map((item) => item.trim()).filter(Boolean);
      if (outcomes.length) {
        await db.insert(academyCourseOutcomes).values(outcomes.map((text, index) => ({
          courseId: existing.id,
          text,
          sortOrder: index,
        })));
      }
    }
    if (Array.isArray(body.lessons)) await syncLessons(existing.id, body.lessons as LessonInput[]);
    return { success: true, data: updated };
  });

  app.delete('/academy/admin/courses/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db.select().from(academyCourses).where(eq(academyCourses.id, Number(id))).limit(1);
    if (!existing) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    if (existing.coverUrl) deleteFromStorage([existing.coverUrl]);
    await db.delete(academyCourses).where(eq(academyCourses.id, existing.id));
    return { success: true };
  });

  app.get('/academy/reviews', async () => {
    const rows = await db
      .select({
        review: academyReviews,
        courseTitle: academyCourses.title,
      })
      .from(academyReviews)
      .innerJoin(academyCourses, eq(academyReviews.courseId, academyCourses.id))
      .where(eq(academyCourses.status, 'published'))
      .orderBy(desc(academyReviews.createdAt));
    return rows.map((row) => ({
      id: row.review.id,
      rating: row.review.rating,
      body: row.review.body,
      reviewerName: row.review.reviewerName,
      reviewerRole: row.review.reviewerRole,
      courseTitle: row.courseTitle,
      createdAt: row.review.createdAt,
    }));
  });

  app.get('/academy/admin/reviews', { preHandler: admin }, async () => {
    const rows = await db
      .select({
        review: academyReviews,
        courseTitle: academyCourses.title,
      })
      .from(academyReviews)
      .innerJoin(academyCourses, eq(academyReviews.courseId, academyCourses.id))
      .orderBy(desc(academyReviews.createdAt));
    return rows.map((row) => ({ ...row.review, courseTitle: row.courseTitle }));
  });

  app.post('/academy/admin/reviews', { preHandler: admin }, async (req, reply) => {
    const body = req.body as {
      courseId?: number;
      rating?: number;
      body?: string;
      reviewerName?: string;
      reviewerRole?: string;
    };
    const rating = Number(body.rating);
    if (!body.courseId || !body.reviewerName?.trim() || !body.body?.trim() || rating < 1 || rating > 5) {
      return reply.status(400).send({ message: 'กรุณากรอกคอร์ส ชื่อ ผู้รีวิว คะแนน 1-5 และข้อความ' });
    }
    const [created] = await db.insert(academyReviews).values({
      courseId: Number(body.courseId),
      rating,
      body: body.body.trim(),
      reviewerName: body.reviewerName.trim(),
      reviewerRole: body.reviewerRole?.trim() || null,
    }).returning();
    return { success: true, data: created };
  });

  app.delete('/academy/admin/reviews/:id', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await db.delete(academyReviews).where(eq(academyReviews.id, Number(id)));
    return { success: true };
  });

  app.get('/academy/stats', async () => {
    const [courseCount] = await db
      .select({ total: sql<string>`count(${academyCourses.id})` })
      .from(academyCourses)
      .where(eq(academyCourses.status, 'published'));
    const [instructorCount] = await db
      .select({ total: sql<string>`count(${academyInstructors.id})` })
      .from(academyInstructors)
      .where(eq(academyInstructors.isVisible, true));
    const [learnerCount] = await db
      .select({ total: sql<string>`count(distinct ${academyEnrollments.pharmacistLicense})` })
      .from(academyEnrollments)
      .where(eq(academyEnrollments.status, 'active'));
    return {
      courseCount: Number(courseCount?.total ?? 0),
      learnerCount: Number(learnerCount?.total ?? 0),
      instructorCount: Number(instructorCount?.total ?? 0),
    };
  });

  app.post('/academy/member/enroll', { preHandler: verifyMemberRequest }, async (req, reply) => {
    const body = (req.body ?? {}) as { courseId?: number; pharmacistLicense?: string; displayName?: string };
    const license = memberLicense(req, body.pharmacistLicense);
    if (!license || !body.courseId) return reply.status(400).send({ message: 'ข้อมูลไม่ครบ' });
    const [course] = await db.select().from(academyCourses)
      .where(and(eq(academyCourses.id, Number(body.courseId)), eq(academyCourses.status, 'published')))
      .limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    if (Number(course.price) > 0) {
      return reply.status(400).send({ message: 'คอร์สนี้ต้องแจ้งชำระเงินก่อนเข้าเรียน' });
    }
    const [existing] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, course.id), eq(academyEnrollments.pharmacistLicense, license)))
      .limit(1);
    if (existing) {
      if (existing.status !== 'active') {
        await db.update(academyEnrollments).set({ status: 'active' }).where(eq(academyEnrollments.id, existing.id));
      }
      return { success: true, enrollmentId: existing.id };
    }
    const [created] = await db.insert(academyEnrollments).values({
      courseId: course.id,
      pharmacistLicense: license,
      displayName: memberName(req, body.displayName) || license,
    }).returning();
    return { success: true, enrollmentId: created.id };
  });

  app.get('/academy/member/courses/:id/learning', async (req, reply) => {
    if (!bridgeOk(req.headers)) return reply.status(401).send({ message: 'ไม่มีสิทธิ์เรียกเส้นนี้' });
    const { id } = req.params as { id: string };
    const license = String((req.query as { license?: string }).license || '');
    if (!license) return reply.status(400).send({ message: 'ไม่พบผู้เรียน' });
    const [course] = await db.select().from(academyCourses)
      .where(and(eq(academyCourses.id, Number(id)), eq(academyCourses.status, 'published')))
      .limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    const [enrollment] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, course.id), eq(academyEnrollments.pharmacistLicense, license), eq(academyEnrollments.status, 'active')))
      .limit(1);
    const lessons = await db.select().from(academyLessons)
      .where(eq(academyLessons.courseId, course.id))
      .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.id));
    const documents = enrollment && lessons.length
      ? await db.select().from(academyLessonDocuments)
        .where(inArray(academyLessonDocuments.lessonId, lessons.map((lesson) => lesson.id)))
        .orderBy(asc(academyLessonDocuments.sortOrder), asc(academyLessonDocuments.id))
      : [];
    const progress = enrollment
      ? await db.select().from(academyLessonProgress).where(eq(academyLessonProgress.pharmacistLicense, license))
      : [];
    const done = new Set(progress.filter((item) => item.isCompleted).map((item) => item.lessonId));
    const lessonsDone = lessons.every((lesson) => done.has(lesson.id));
    const exam = Array.isArray(course.exam) ? course.exam as QuizQuestion[] : [];
    const [order] = await db.select().from(academyOrders)
      .where(and(eq(academyOrders.courseId, course.id), eq(academyOrders.pharmacistLicense, license)))
      .orderBy(desc(academyOrders.createdAt))
      .limit(1);
    return {
      enrolled: Boolean(enrollment),
      ...placeOf(course),
      orderStatus: order?.status ?? null,
      progressPercent: Number(enrollment?.progressPercent ?? 0),
      price: course.price,
      hasExam: exam.length > 0,
      examPassed: Boolean(enrollment?.examPassed),
      exam: enrollment && lessonsDone
        ? exam.map((item) => ({ question: item.question, options: item.options }))
        : [],
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        videoUrl: enrollment ? lesson.videoUrl : null,
        completed: done.has(lesson.id),
        documents: documents.filter((document) => document.lessonId === lesson.id).map((document) => ({
          name: document.name,
          fileUrl: document.fileUrl,
        })),
        quiz: enrollment && Array.isArray(lesson.quiz)
          ? (lesson.quiz as QuizQuestion[]).map((item) => ({ question: item.question, options: item.options }))
          : [],
      })),
    };
  });

  app.post('/academy/member/lessons/:id/complete', async (req, reply) => {
    if (!bridgeOk(req.headers)) return reply.status(401).send({ message: 'ไม่มีสิทธิ์เรียกเส้นนี้' });
    const { id } = req.params as { id: string };
    const body = req.body as { pharmacistLicense?: string; answers?: string[] };
    const license = body.pharmacistLicense?.trim();
    if (!license) return reply.status(400).send({ message: 'ไม่พบผู้เรียน' });
    const [lesson] = await db.select().from(academyLessons).where(eq(academyLessons.id, Number(id))).limit(1);
    if (!lesson) return reply.status(404).send({ message: 'ไม่พบบทเรียน' });
    const [enrollment] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, lesson.courseId), eq(academyEnrollments.pharmacistLicense, license), eq(academyEnrollments.status, 'active')))
      .limit(1);
    if (!enrollment) return reply.status(403).send({ message: 'ยังไม่ได้ลงทะเบียนเรียน' });
    const quiz = Array.isArray(lesson.quiz) ? lesson.quiz as QuizQuestion[] : [];
    if (quiz.length) {
      const answers = body.answers || [];
      const correct = quiz.every((item, index) => answers[index] === item.answer);
      if (!correct) return reply.status(400).send({ message: 'คำตอบยังไม่ถูกต้อง' });
    }
    const [current] = await db.select().from(academyLessonProgress)
      .where(and(eq(academyLessonProgress.lessonId, lesson.id), eq(academyLessonProgress.pharmacistLicense, license)))
      .limit(1);
    if (current) {
      await db.update(academyLessonProgress).set({ isCompleted: true, updatedAt: new Date() }).where(eq(academyLessonProgress.id, current.id));
    } else {
      await db.insert(academyLessonProgress).values({ pharmacistLicense: license, lessonId: lesson.id, isCompleted: true });
    }
    const { percent } = await refreshProgress(enrollment.id, lesson.courseId, license);
    return { success: true, progressPercent: percent };
  });

  app.post('/academy/member/courses/:id/cancel', async (req, reply) => {
    if (!bridgeOk(req.headers)) return reply.status(401).send({ message: 'ไม่มีสิทธิ์เรียกเส้นนี้' });
    const { id } = req.params as { id: string };
    const license = String((req.body as { pharmacistLicense?: string }).pharmacistLicense || '').trim();
    if (!license) return reply.status(400).send({ message: 'ไม่พบผู้เรียน' });
    const [enrollment] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, Number(id)), eq(academyEnrollments.pharmacistLicense, license), eq(academyEnrollments.status, 'active')))
      .limit(1);
    if (!enrollment) return reply.status(404).send({ message: 'ไม่พบการลงทะเบียน' });
    if (Number(enrollment.progressPercent) >= 100) return reply.status(400).send({ message: 'เรียนจบแล้ว ยกเลิกไม่ได้' });
    await db.update(academyEnrollments).set({ status: 'cancelled' }).where(eq(academyEnrollments.id, enrollment.id));
    return { success: true };
  });

  app.post('/academy/member/courses/:id/exam', async (req, reply) => {
    if (!bridgeOk(req.headers)) return reply.status(401).send({ message: 'ไม่มีสิทธิ์เรียกเส้นนี้' });
    const { id } = req.params as { id: string };
    const body = req.body as { pharmacistLicense?: string; answers?: string[] };
    const license = body.pharmacistLicense?.trim();
    if (!license) return reply.status(400).send({ message: 'ไม่พบผู้เรียน' });
    const [course] = await db.select().from(academyCourses).where(eq(academyCourses.id, Number(id))).limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    const [enrollment] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, course.id), eq(academyEnrollments.pharmacistLicense, license), eq(academyEnrollments.status, 'active')))
      .limit(1);
    if (!enrollment) return reply.status(403).send({ message: 'ยังไม่ได้ลงทะเบียนเรียน' });
    const lessons = await db.select().from(academyLessons).where(eq(academyLessons.courseId, course.id));
    const doneRows = await db.select().from(academyLessonProgress)
      .where(and(eq(academyLessonProgress.pharmacistLicense, license), eq(academyLessonProgress.isCompleted, true)));
    const doneIds = new Set(doneRows.map((item) => item.lessonId));
    if (lessons.some((lesson) => !doneIds.has(lesson.id))) return reply.status(400).send({ message: 'เรียนทุกบทให้จบก่อนสอบ' });
    const exam = Array.isArray(course.exam) ? course.exam as QuizQuestion[] : [];
    if (!exam.length) return reply.status(400).send({ message: 'คอร์สนี้ไม่มีข้อสอบจบ' });
    const answers = body.answers || [];
    if (!exam.every((item, index) => answers[index] === item.answer)) {
      return reply.status(400).send({ message: 'คำตอบยังไม่ถูกต้อง' });
    }
    await db.update(academyEnrollments).set({ examPassed: true }).where(eq(academyEnrollments.id, enrollment.id));
    const { percent } = await refreshProgress(enrollment.id, course.id, license);
    return { success: true, progressPercent: percent };
  });

  app.get('/academy/member/enrollments', { preHandler: verifyMemberRequest }, async (req, reply) => {
    const license = memberLicense(req, (req.query as { license?: string }).license);
    if (!license) return reply.status(400).send({ message: 'ไม่พบผู้เรียน' });
    const rows = await db.select({
      enrollment: academyEnrollments,
      title: academyCourses.title,
      coverUrl: academyCourses.coverUrl,
    }).from(academyEnrollments)
      .innerJoin(academyCourses, eq(academyEnrollments.courseId, academyCourses.id))
      .where(eq(academyEnrollments.pharmacistLicense, license))
      .orderBy(desc(academyEnrollments.enrolledAt));
    return rows.map((row) => ({
      courseId: row.enrollment.courseId,
      title: row.title,
      coverUrl: row.coverUrl,
      status: row.enrollment.status,
      progressPercent: Number(row.enrollment.progressPercent ?? 0),
    }));
  });

  app.get('/academy/admin/enrollments', { preHandler: admin }, async (req) => {
    const input = req.query as { page?: string; pageSize?: string; q?: string; status?: string; courseId?: string };
    const query = listQuery(input, ['active', 'cancelled']);
    const courseId = Number(input.courseId);
    const selectedCourse = Number.isInteger(courseId) && courseId > 0 ? eq(academyEnrollments.courseId, courseId) : undefined;
    const searchWhere = listWhere(query.q, query.status, academyEnrollments.status, [
      academyEnrollments.displayName,
      academyEnrollments.pharmacistLicense,
      academyCourses.title,
    ]);
    const where = and(selectedCourse, searchWhere);
    const joined = db.select({ total: sql<number>`count(*)::int` }).from(academyEnrollments)
      .innerJoin(academyCourses, eq(academyEnrollments.courseId, academyCourses.id));
    const [{ total }] = await (where ? joined.where(where) : joined);
    const listed = db.select({
      enrollment: academyEnrollments,
      title: academyCourses.title,
    }).from(academyEnrollments)
      .innerJoin(academyCourses, eq(academyEnrollments.courseId, academyCourses.id));
    const rows = await (where ? listed.where(where) : listed)
      .orderBy(desc(academyEnrollments.enrolledAt))
      .limit(query.pageSize)
      .offset(query.offset);
    return {
      total: Number(total),
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.enrollment.id,
        courseId: row.enrollment.courseId,
        courseTitle: row.title,
        pharmacistLicense: row.enrollment.pharmacistLicense,
        displayName: row.enrollment.displayName,
        status: row.enrollment.status,
        progressPercent: Number(row.enrollment.progressPercent ?? 0),
        examPassed: row.enrollment.examPassed,
        enrolledAt: row.enrollment.enrolledAt,
      })),
    };
  });

  app.post('/academy/member/upload', async (req, reply) => {
    if (!bridgeOk(req.headers)) return reply.status(401).send({ message: 'ไม่มีสิทธิ์เรียกเส้นนี้' });
    const data = await req.file();
    if (!data) return reply.status(400).send({ message: 'ไม่พบไฟล์' });
    if (!data.mimetype.startsWith('image/')) return reply.status(400).send({ message: 'อัปโหลดได้เฉพาะรูปสลิป' });
    const buffer = await streamToBuffer(data.file);
    const url = await uploadToStorage('academy-slips', buffer, data.filename, data.mimetype);
    if (!url) return reply.status(500).send({ message: 'อัปโหลดไม่สำเร็จ' });
    return { url };
  });

  app.post('/academy/member/orders', { preHandler: verifyMemberRequest }, async (req, reply) => {
    const body = (req.body ?? {}) as { courseId?: number; pharmacistLicense?: string; displayName?: string; slipUrl?: string };
    const license = memberLicense(req, body.pharmacistLicense);
    if (!license || !body.courseId) return reply.status(400).send({ message: 'ข้อมูลไม่ครบ' });
    const [course] = await db.select().from(academyCourses)
      .where(and(eq(academyCourses.id, Number(body.courseId)), eq(academyCourses.status, 'published')))
      .limit(1);
    if (!course) return reply.status(404).send({ message: 'ไม่พบคอร์ส' });
    if (Number(course.price) <= 0) return reply.status(400).send({ message: 'คอร์สนี้เรียนฟรี ไม่ต้องแจ้งชำระ' });
    const [enrollment] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, course.id), eq(academyEnrollments.pharmacistLicense, license), eq(academyEnrollments.status, 'active')))
      .limit(1);
    if (enrollment) return reply.status(400).send({ message: 'ลงทะเบียนคอร์สนี้แล้ว' });
    const displayName = memberName(req, body.displayName) || license;
    const [pending] = await db.select().from(academyOrders)
      .where(and(eq(academyOrders.courseId, course.id), eq(academyOrders.pharmacistLicense, license), eq(academyOrders.status, 'pending')))
      .limit(1);
    const order = pending
      ? (await db.update(academyOrders).set({ status: 'paid', reviewedAt: new Date() }).where(eq(academyOrders.id, pending.id)).returning())[0]
      : (await db.insert(academyOrders).values({
        courseId: course.id,
        pharmacistLicense: license,
        displayName,
        amount: course.price,
        status: 'paid',
        reviewedAt: new Date(),
      }).returning())[0];
    const [existing] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, course.id), eq(academyEnrollments.pharmacistLicense, license)))
      .limit(1);
    if (existing) {
      if (existing.status !== 'active') await db.update(academyEnrollments).set({ status: 'active' }).where(eq(academyEnrollments.id, existing.id));
    } else {
      await db.insert(academyEnrollments).values({ courseId: course.id, pharmacistLicense: license, displayName });
    }
    return { success: true, orderId: order.id, status: 'paid' };
  });

  app.post('/academy/member/courses/:id/refund', async (req, reply) => {
    if (!bridgeOk(req.headers)) return reply.status(401).send({ message: 'ไม่มีสิทธิ์เรียกเส้นนี้' });
    const { id } = req.params as { id: string };
    const body = req.body as { pharmacistLicense?: string; reason?: string };
    const license = body.pharmacistLicense?.trim();
    const reason = body.reason?.trim();
    if (!license || !reason) return reply.status(400).send({ message: 'กรุณาระบุเหตุผล' });
    const [enrollment] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, Number(id)), eq(academyEnrollments.pharmacistLicense, license), eq(academyEnrollments.status, 'active')))
      .limit(1);
    if (!enrollment) return reply.status(404).send({ message: 'ไม่พบการลงทะเบียน' });
    if (Number(enrollment.progressPercent) >= 100) return reply.status(400).send({ message: 'เรียนจบแล้ว ขอคืนเงินไม่ได้' });
    const [order] = await db.select().from(academyOrders)
      .where(and(eq(academyOrders.courseId, Number(id)), eq(academyOrders.pharmacistLicense, license), eq(academyOrders.status, 'paid')))
      .orderBy(desc(academyOrders.createdAt))
      .limit(1);
    if (!order) return reply.status(400).send({ message: 'ไม่พบรายการที่ชำระแล้ว' });
    await db.insert(academyRefundRequests).values({ orderId: order.id, reason, status: 'approved' });
    await db.update(academyOrders).set({ status: 'refunded', reviewedAt: new Date() }).where(eq(academyOrders.id, order.id));
    await db.update(academyEnrollments).set({ status: 'cancelled' }).where(eq(academyEnrollments.id, enrollment.id));
    return { success: true };
  });

  app.get('/academy/member/courses/:id/certificate', async (req, reply) => {
    if (!bridgeOk(req.headers)) return reply.status(401).send({ message: 'ไม่มีสิทธิ์เรียกเส้นนี้' });
    const { id } = req.params as { id: string };
    const license = String((req.query as { license?: string }).license || '');
    if (!license) return reply.status(400).send({ message: 'ไม่พบผู้เรียน' });
    const [row] = await db.select({
      enrollment: academyEnrollments,
      course: academyCourses,
    }).from(academyEnrollments)
      .innerJoin(academyCourses, eq(academyEnrollments.courseId, academyCourses.id))
      .where(and(eq(academyEnrollments.courseId, Number(id)), eq(academyEnrollments.pharmacistLicense, license), eq(academyEnrollments.status, 'active')))
      .limit(1);
    if (!row) return reply.status(404).send({ message: 'ไม่พบการลงทะเบียน' });
    if (Number(row.enrollment.progressPercent) < 100) return reply.status(400).send({ message: 'เรียนให้จบก่อนรับใบประกาศ' });
    const [existing] = await db.select().from(academyCertificates).where(eq(academyCertificates.enrollmentId, row.enrollment.id)).limit(1);
    const certificate = existing ?? (await db.insert(academyCertificates).values({
      enrollmentId: row.enrollment.id,
      code: `AC${new Date().getFullYear()}${String(row.enrollment.id).padStart(5, '0')}`,
    }).returning())[0];
    return {
      code: certificate.code,
      issuedAt: certificate.issuedAt,
      learnerName: row.enrollment.displayName,
      pharmacistLicense: row.enrollment.pharmacistLicense,
      courseTitle: row.course.title,
      cpeCredits: row.course.cpeCredits,
      conferenceCode: row.course.conferenceCode,
    };
  });

  app.get('/academy/admin/orders', { preHandler: admin }, async (req) => {
    const query = listQuery(req.query as { page?: string; pageSize?: string; q?: string; status?: string }, ['pending', 'paid', 'rejected', 'refunded']);
    const where = listWhere(query.q, query.status, academyOrders.status, [
      academyOrders.displayName,
      academyOrders.pharmacistLicense,
      academyCourses.title,
    ]);
    const joined = db.select({ total: sql<number>`count(*)::int` }).from(academyOrders)
      .innerJoin(academyCourses, eq(academyOrders.courseId, academyCourses.id));
    const [{ total }] = await (where ? joined.where(where) : joined);
    const listed = db.select({
      order: academyOrders,
      title: academyCourses.title,
    }).from(academyOrders)
      .innerJoin(academyCourses, eq(academyOrders.courseId, academyCourses.id));
    const rows = await (where ? listed.where(where) : listed)
      .orderBy(desc(academyOrders.createdAt))
      .limit(query.pageSize)
      .offset(query.offset);
    return {
      total: Number(total),
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({ ...row.order, courseTitle: row.title })),
    };
  });

  app.post('/academy/admin/orders/:id/approve', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [order] = await db.select().from(academyOrders).where(eq(academyOrders.id, Number(id))).limit(1);
    if (!order || order.status !== 'pending') return reply.status(400).send({ message: 'รายการนี้ยืนยันไม่ได้' });
    await db.update(academyOrders).set({ status: 'paid', reviewedAt: new Date() }).where(eq(academyOrders.id, order.id));
    const [existing] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, order.courseId), eq(academyEnrollments.pharmacistLicense, order.pharmacistLicense)))
      .limit(1);
    if (existing) {
      if (existing.status !== 'active') await db.update(academyEnrollments).set({ status: 'active' }).where(eq(academyEnrollments.id, existing.id));
    } else {
      await db.insert(academyEnrollments).values({
        courseId: order.courseId,
        pharmacistLicense: order.pharmacistLicense,
        displayName: order.displayName,
      });
    }
    return { success: true };
  });

  app.post('/academy/admin/orders/:id/reject', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [order] = await db.select().from(academyOrders).where(eq(academyOrders.id, Number(id))).limit(1);
    if (!order || order.status !== 'pending') return reply.status(400).send({ message: 'รายการนี้ปฏิเสธไม่ได้' });
    await db.update(academyOrders).set({ status: 'rejected', reviewedAt: new Date() }).where(eq(academyOrders.id, order.id));
    return { success: true };
  });

  app.get('/academy/admin/refunds', { preHandler: admin }, async () => {
    const rows = await db.select({
      refund: academyRefundRequests,
      order: academyOrders,
      title: academyCourses.title,
    }).from(academyRefundRequests)
      .innerJoin(academyOrders, eq(academyRefundRequests.orderId, academyOrders.id))
      .innerJoin(academyCourses, eq(academyOrders.courseId, academyCourses.id))
      .orderBy(desc(academyRefundRequests.createdAt));
    return rows.map((row) => ({
      id: row.refund.id,
      reason: row.refund.reason,
      status: row.refund.status,
      courseTitle: row.title,
      pharmacistLicense: row.order.pharmacistLicense,
      displayName: row.order.displayName,
      amount: row.order.amount,
    }));
  });

  app.post('/academy/admin/refunds/:id/approve', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [refund] = await db.select().from(academyRefundRequests).where(eq(academyRefundRequests.id, Number(id))).limit(1);
    if (!refund || refund.status !== 'pending') return reply.status(400).send({ message: 'คำขอนี้พิจารณาไม่ได้' });
    const [order] = await db.select().from(academyOrders).where(eq(academyOrders.id, refund.orderId)).limit(1);
    if (!order) return reply.status(404).send({ message: 'ไม่พบคำสั่งซื้อ' });
    const [enrollment] = await db.select().from(academyEnrollments)
      .where(and(eq(academyEnrollments.courseId, order.courseId), eq(academyEnrollments.pharmacistLicense, order.pharmacistLicense), eq(academyEnrollments.status, 'active')))
      .limit(1);
    if (enrollment && Number(enrollment.progressPercent) >= 100) return reply.status(400).send({ message: 'เรียนจบแล้ว คืนเงินไม่ได้' });
    await db.update(academyRefundRequests).set({ status: 'approved' }).where(eq(academyRefundRequests.id, refund.id));
    await db.update(academyOrders).set({ status: 'refunded', reviewedAt: new Date() }).where(eq(academyOrders.id, order.id));
    if (enrollment) await db.update(academyEnrollments).set({ status: 'cancelled' }).where(eq(academyEnrollments.id, enrollment.id));
    return { success: true };
  });

  app.post('/academy/admin/refunds/:id/reject', { preHandler: admin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [refund] = await db.select().from(academyRefundRequests).where(eq(academyRefundRequests.id, Number(id))).limit(1);
    if (!refund || refund.status !== 'pending') return reply.status(400).send({ message: 'คำขอนี้พิจารณาไม่ได้' });
    await db.update(academyRefundRequests).set({ status: 'rejected' }).where(eq(academyRefundRequests.id, refund.id));
    return { success: true };
  });

  app.get('/academy/admin/cpe', { preHandler: admin }, async () => {
    const rows = await db.select({
      enrollment: academyEnrollments,
      course: academyCourses,
    }).from(academyEnrollments)
      .innerJoin(academyCourses, eq(academyEnrollments.courseId, academyCourses.id))
      .where(and(eq(academyEnrollments.status, 'active'), sql`${academyEnrollments.progressPercent} >= 100`))
      .orderBy(desc(academyEnrollments.enrolledAt));
    return rows.map((row) => ({
      pharmacistLicense: row.enrollment.pharmacistLicense,
      displayName: row.enrollment.displayName,
      courseTitle: row.course.title,
      cpeCredits: row.course.cpeCredits,
      conferenceCode: row.course.conferenceCode,
    }));
  });
}

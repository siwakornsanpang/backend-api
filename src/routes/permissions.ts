// src/routes/permissions.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { permissions, rolePermissions } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyToken, requireRole } from '../utils/authGuard';

export async function permissionRoutes(app: FastifyInstance) {

  // -------------------------------------------------------
  // GET /permissions — ดึง permissions ทั้งหมด
  // -------------------------------------------------------
  app.get('/permissions', { preHandler: [verifyToken, requireRole('admin')] }, async (req, reply) => {
    return await db.select().from(permissions);
  });

  // -------------------------------------------------------
  // POST /permissions — สร้าง permission ใหม่
  // -------------------------------------------------------
  app.post('/permissions', { preHandler: [verifyToken, requireRole('admin')] }, async (req, reply) => {
    const { key, label, group } = req.body as { key: string; label: string; group?: string };

    if (!key || !label) {
      return reply.status(400).send({ message: 'กรุณากรอก key และ label' });
    }

    // เช็คว่า key ซ้ำหรือไม่
    const existing = await db.select().from(permissions).where(eq(permissions.key, key)).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ message: `Key "${key}" มีอยู่แล้ว` });
    }

    const result = await db.insert(permissions).values({ key, label, group: group || null }).returning();

    // เพิ่มให้ admin อัตโนมัติ
    await db.insert(rolePermissions).values({ role: 'admin', permissionKey: key });

    return { success: true, permission: result[0] };
  });

  // -------------------------------------------------------
  // GET /permissions/roles/:role — ดึง permissions ของ role
  // -------------------------------------------------------
  app.get('/permissions/roles/:role', { preHandler: [verifyToken, requireRole('admin')] }, async (req, reply) => {
    const { role } = req.params as { role: string };
    const result = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
    return result.map(r => r.permissionKey);
  });

  // -------------------------------------------------------
  // GET /permissions/my — ดึง permissions ของ user ที่ login อยู่
  // -------------------------------------------------------
  app.get('/permissions/my', { preHandler: [verifyToken] }, async (req, reply) => {
    const user = req.user as any;

    // admin ได้ทุก permission
    if (user.role === 'admin') {
      const allPerms = await db.select().from(permissions);
      return allPerms.map(p => p.key);
    }

    const result = await db.select().from(rolePermissions).where(eq(rolePermissions.role, user.role));
    return result.map(r => r.permissionKey);
  });

  // -------------------------------------------------------
  // PUT /permissions/roles/:role — อัพเดท permissions ของ role
  // body: { permissions: ['manage_news', 'manage_council', ...] }
  // -------------------------------------------------------
  app.put('/permissions/roles/:role', { preHandler: [verifyToken, requireRole('admin')] }, async (req, reply) => {
    const { role } = req.params as { role: string };
    const { permissions: permKeys } = req.body as { permissions: string[] };

    // 1. ลบ permissions เก่าของ role นี้ทั้งหมด
    await db.delete(rolePermissions).where(eq(rolePermissions.role, role));

    // 2. เพิ่ม permissions ใหม่
    if (permKeys && permKeys.length > 0) {
      await db.insert(rolePermissions).values(
        permKeys.map(key => ({ role, permissionKey: key }))
      );
    }

    return { success: true, role, permissions: permKeys };
  });

  // -------------------------------------------------------
  // POST /permissions/seed — สร้าง default permissions
  // -------------------------------------------------------
  app.post('/permissions/seed', { preHandler: [verifyToken, requireRole('admin')] }, async (req, reply) => {
    // เช็คว่ามี permissions อยู่แล้วหรือยัง
    const existing = await db.select().from(permissions).limit(1);
    if (existing.length > 0) {
      return reply.status(400).send({ message: 'Permissions มีอยู่แล้ว ไม่ต้อง seed ซ้ำ' });
    }

    // สร้าง default permissions
    const defaultPermissions = [
      // เว็บไซต์
      { key: 'manage_home', label: 'จัดการหน้าแรก', group: 'เว็บไซต์' },
      { key: 'manage_news', label: 'จัดการข่าวสาร', group: 'เว็บไซต์' },
      { key: 'manage_council', label: 'จัดการกรรมการสภา', group: 'เว็บไซต์' },
      { key: 'manage_history', label: 'จัดการทำเนียบ', group: 'เว็บไซต์' },
      { key: 'manage_agency', label: 'จัดการหน่วยงาน', group: 'เว็บไซต์' },
      { key: 'manage_law', label: 'จัดการกฎหมาย', group: 'เว็บไซต์' },
      { key: 'manage_web_settings', label: 'ตั้งค่าเว็บไซต์', group: 'เว็บไซต์' },

      // ระบบ
      { key: 'manage_register', label: 'จัดการทะเบียน', group: 'ระบบ' },
      { key: 'view_dashboard', label: 'ดู Dashboard', group: 'ระบบ' },
      { key: 'manage_users', label: 'จัดการผู้ใช้', group: 'ระบบ' },
      { key: 'manage_roles', label: 'จัดการสิทธิ์', group: 'ระบบ' },
    ];

    await db.insert(permissions).values(defaultPermissions);

    // Seed role permissions สำหรับ admin (ทุก permission)
    const adminPerms = defaultPermissions.map(p => ({
      role: 'admin',
      permissionKey: p.key,
    }));
    await db.insert(rolePermissions).values(adminPerms);

    // Seed role permissions สำหรับ editor
    const editorPerms = ['manage_home', 'manage_news', 'manage_council', 'manage_history', 'manage_agency', 'manage_law', 'manage_web_settings', 'view_dashboard'];
    await db.insert(rolePermissions).values(
      editorPerms.map(key => ({ role: 'editor', permissionKey: key }))
    );

    // Seed role permissions สำหรับ web_editor
    const webEditorPerms = ['manage_home', 'manage_news', 'manage_council', 'manage_history', 'manage_agency', 'manage_law', 'manage_web_settings', 'view_dashboard'];
    await db.insert(rolePermissions).values(
      webEditorPerms.map(key => ({ role: 'web_editor', permissionKey: key }))
    );

    // Seed role permissions สำหรับ viewer (แค่ดู dashboard)
    await db.insert(rolePermissions).values([
      { role: 'viewer', permissionKey: 'view_dashboard' },
    ]);

    return { success: true, message: 'Seed permissions เรียบร้อย', count: defaultPermissions.length };
  });
}

// src/routes/permissions.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { permissions, rolePermissions, users } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';

export async function permissionRoutes(app: FastifyInstance) {

  // =============================================================
  // PERMISSIONS CRUD
  // =============================================================

  // GET /permissions — ดึง permissions ทั้งหมด
  app.get('/permissions', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    return await db.select().from(permissions);
  });

  // POST /permissions — สร้าง permission ใหม่
  app.post('/permissions', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    const { key, label, group } = req.body as { key: string; label: string; group?: string };

    if (!key || !label) {
      return reply.status(400).send({ message: 'กรุณากรอก key และ label' });
    }

    const existing = await db.select().from(permissions).where(eq(permissions.key, key)).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ message: `Key "${key}" มีอยู่แล้ว` });
    }

    const result = await db.insert(permissions).values({ key, label, group: group || null }).returning();

    // เพิ่มให้ admin อัตโนมัติ
    await db.insert(rolePermissions).values({ role: 'admin', permissionKey: key });

    return { success: true, permission: result[0] };
  });

  // DELETE /permissions/:key — ลบ permission
  app.delete('/permissions/:key', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    const { key } = req.params as { key: string };
    
    // ลบ role_permissions ที่เกี่ยวข้องก่อน
    await db.delete(rolePermissions).where(eq(rolePermissions.permissionKey, key));
    // ลบ permission
    await db.delete(permissions).where(eq(permissions.key, key));

    return { success: true };
  });

  // =============================================================
  // ROLE PERMISSIONS MANAGEMENT
  // =============================================================

  // GET /permissions/roles — ดึง roles ทั้งหมดพร้อมจำนวน permission
  app.get('/permissions/roles', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    // ดึง roles ที่ไม่ซ้ำจาก role_permissions + users table
    const rolesFromPerms = await db.selectDistinct({ role: rolePermissions.role }).from(rolePermissions);
    const rolesFromUsers = await db.selectDistinct({ role: users.role }).from(users);
    
    // รวม roles ทั้งสองแหล่งให้ไม่ซ้ำ
    const allRoles = new Set<string>();
    rolesFromPerms.forEach(r => allRoles.add(r.role));
    rolesFromUsers.forEach(r => allRoles.add(r.role));

    // นับจำนวน permissions ของแต่ละ role
    const result = [];
    for (const role of allRoles) {
      const perms = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
      result.push({ role, permissionCount: perms.length });
    }

    return result;
  });

  // GET /permissions/roles/:role — ดึง permissions ของ role
  app.get('/permissions/roles/:role', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    const { role } = req.params as { role: string };
    const result = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
    return result.map(r => r.permissionKey);
  });

  // PUT /permissions/roles/:role — อัพเดท permissions ของ role
  app.put('/permissions/roles/:role', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    const { role } = req.params as { role: string };
    const { permissions: permKeys } = req.body as { permissions: string[] };

    // ลบ permissions เก่า
    await db.delete(rolePermissions).where(eq(rolePermissions.role, role));

    // เพิ่ม permissions ใหม่
    if (permKeys && permKeys.length > 0) {
      await db.insert(rolePermissions).values(
        permKeys.map(key => ({ role, permissionKey: key }))
      );
    }

    return { success: true, role, permissions: permKeys };
  });

  // POST /permissions/roles — สร้าง Role ใหม่
  app.post('/permissions/roles', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    const { role, permissions: permKeys } = req.body as { role: string; permissions?: string[] };

    if (!role) {
      return reply.status(400).send({ message: 'กรุณากรอกชื่อ Role' });
    }

    // เช็คว่ามี role นี้อยู่แล้วหรือไม่ (เช็คจาก role_permissions)
    const existing = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ message: `Role "${role}" มีอยู่แล้ว` });
    }

    // ถ้ามี permissions ให้เพิ่มด้วย
    if (permKeys && permKeys.length > 0) {
      await db.insert(rolePermissions).values(
        permKeys.map(key => ({ role, permissionKey: key }))
      );
    } else {
      // สร้าง role เปล่า — ใส่ view_dashboard เป็น default
      await db.insert(rolePermissions).values({ role, permissionKey: 'view_dashboard' });
    }

    return { success: true, role };
  });

  // DELETE /permissions/roles/:role — ลบ Role
  app.delete('/permissions/roles/:role', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    const { role } = req.params as { role: string };

    // ห้ามลบ admin
    if (role === 'admin') {
      return reply.status(400).send({ message: 'ไม่สามารถลบ Role admin ได้' });
    }

    // เช็คว่ามี users ที่ใช้ role นี้อยู่ไหม
    const usersWithRole = await db.select().from(users).where(eq(users.role, role)).limit(1);
    if (usersWithRole.length > 0) {
      return reply.status(400).send({ message: `ไม่สามารถลบได้ — มีผู้ใช้ที่ใช้ Role "${role}" อยู่` });
    }

    // ลบ role_permissions
    await db.delete(rolePermissions).where(eq(rolePermissions.role, role));

    return { success: true };
  });

  // =============================================================
  // MY PERMISSIONS (ผู้ใช้ดึงของตัวเอง)
  // =============================================================

  // GET /permissions/my — ดึง permissions ของ user ที่ login อยู่
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

  // =============================================================
  // SEED (เริ่มต้น)
  // =============================================================

  app.post('/permissions/seed', { preHandler: [verifyToken, requirePermission('manage_roles')] }, async (req, reply) => {
    const existing = await db.select().from(permissions).limit(1);
    if (existing.length > 0) {
      return reply.status(400).send({ message: 'Permissions มีอยู่แล้ว ไม่ต้อง seed ซ้ำ' });
    }

    const defaultPermissions = [
      { key: 'manage_home', label: 'จัดการหน้าแรก', group: 'เว็บไซต์' },
      { key: 'manage_news', label: 'จัดการข่าวสาร', group: 'เว็บไซต์' },
      { key: 'manage_council', label: 'จัดการกรรมการสภา', group: 'เว็บไซต์' },
      { key: 'manage_history', label: 'จัดการทำเนียบ', group: 'เว็บไซต์' },
      { key: 'manage_agency', label: 'จัดการหน่วยงาน', group: 'เว็บไซต์' },
      { key: 'manage_law', label: 'จัดการกฎหมาย', group: 'เว็บไซต์' },
      { key: 'manage_web_settings', label: 'ตั้งค่าเว็บไซต์', group: 'เว็บไซต์' },
      { key: 'manage_register', label: 'จัดการทะเบียน', group: 'ระบบ' },
      { key: 'view_dashboard', label: 'ดู Dashboard', group: 'ระบบ' },
      { key: 'manage_users', label: 'จัดการผู้ใช้', group: 'ระบบ' },
      { key: 'manage_roles', label: 'จัดการสิทธิ์', group: 'ระบบ' },
    ];

    await db.insert(permissions).values(defaultPermissions);

    // Admin ได้ทุก permission
    await db.insert(rolePermissions).values(
      defaultPermissions.map(p => ({ role: 'admin', permissionKey: p.key }))
    );

    // Editor
    const editorPerms = ['manage_home', 'manage_news', 'manage_council', 'manage_history', 'manage_agency', 'manage_law', 'manage_web_settings', 'view_dashboard'];
    await db.insert(rolePermissions).values(editorPerms.map(key => ({ role: 'editor', permissionKey: key })));

    // Web Editor
    await db.insert(rolePermissions).values(editorPerms.map(key => ({ role: 'web_editor', permissionKey: key })));

    // Viewer
    await db.insert(rolePermissions).values([{ role: 'viewer', permissionKey: 'view_dashboard' }]);

    return { success: true, message: 'Seed permissions เรียบร้อย', count: defaultPermissions.length };
  });
}

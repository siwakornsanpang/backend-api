// src/routes/auth.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { users, permissions, rolePermissions } from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { verifyToken, requireRole, requirePermission, AuthUser } from '../utils/authGuard';

const SALT_ROUNDS = 12;

/** ดึง permissions ของ role จาก DB */
async function getPermissionsForRole(role: string): Promise<string[]> {
  if (role === 'admin') {
    const allPerms = await db.select().from(permissions);
    return allPerms.map(p => p.key);
  }
  const result = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
  return result.map(r => r.permissionKey);
}

export async function authRoutes(app: FastifyInstance) {

  // -------------------------------------------------------
  // POST /auth/login — เข้าสู่ระบบ
  // -------------------------------------------------------
  app.post('/auth/login', async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string };

    if (!username || !password) {
      return reply.status(400).send({ message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    // ค้นหา user ใน DB
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);

    if (result.length === 0) {
      // ไม่บอกว่า "ไม่พบ username" เพื่อป้องกัน user enumeration
      return reply.status(401).send({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = result[0];

    // ตรวจสอบ password ด้วย bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return reply.status(401).send({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    // สร้าง JWT Token
    const token = app.jwt.sign(
      {
        userId: user.id,
        role: user.role,
        displayName: user.displayName || user.username,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    // ดึง permissions ของ role
    const userPermissions = await getPermissionsForRole(user.role);

    return {
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role,
        permissions: userPermissions,
      },
    };
  });

  // -------------------------------------------------------
  // GET /auth/me — ดึงข้อมูลตัวเอง
  // -------------------------------------------------------
  app.get('/auth/me', { preHandler: [verifyToken] }, async (req, reply) => {
    const user = req.user as AuthUser;
    const result = await db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, user.userId)).limit(1);

    if (result.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบข้อมูลผู้ใช้' });
    }

    const userPermissions = await getPermissionsForRole(result[0].role!);

    return { ...result[0], permissions: userPermissions };
  });

  // -------------------------------------------------------
  // POST /auth/seed — สร้าง Admin คนแรก
  // ทำงานเฉพาะตอน users table ว่างเปล่า
  // -------------------------------------------------------
  app.post('/auth/seed', async (req, reply) => {
    // เช็คว่ามี user อยู่แล้วหรือยัง
    const existing = await db.select().from(users).limit(1);

    if (existing.length > 0) {
      return reply.status(403).send({ 
        message: 'ไม่สามารถทำได้: มีผู้ใช้ในระบบแล้ว' 
      });
    }

    // สร้าง admin คนแรก
    const passwordHash = await bcrypt.hash('1234', SALT_ROUNDS);

    const result = await db.insert(users).values({
      username: 'admin',
      passwordHash,
      displayName: 'ผู้ดูแลระบบ',
      role: 'admin',
    }).returning({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
    });

    return {
      success: true,
      message: 'สร้าง Admin สำเร็จ — กรุณาเปลี่ยนรหัสผ่านทันที',
      user: result[0],
    };
  });

  // -------------------------------------------------------
  // GET /auth/users — ดูรายชื่อ Users ทั้งหมด (admin only)
  // -------------------------------------------------------
  app.get('/auth/users', { preHandler: [verifyToken, requirePermission('manage_users')] }, async (req, reply) => {
    const result = await db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users);

    return result;
  });

  // -------------------------------------------------------
  // POST /auth/users — สร้าง User ใหม่ (admin only)
  // -------------------------------------------------------
  app.post('/auth/users', { preHandler: [verifyToken, requirePermission('manage_users')] }, async (req, reply) => {
    const { username, password, displayName, role } = req.body as {
      username: string;
      password: string;
      displayName?: string;
      role?: string;
    };

    if (!username || !password) {
      return reply.status(400).send({ message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    // เช็คว่า role ถูกต้อง
    const validRoles = ['admin', 'editor', 'viewer', 'web_editor'];
    const userRole = role || 'viewer';
    if (!validRoles.includes(userRole)) {
      return reply.status(400).send({ message: `Role ไม่ถูกต้อง: ต้องเป็น ${validRoles.join(', ')}` });
    }

    // เช็คว่า username ซ้ำหรือไม่
    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ message: 'ชื่อผู้ใช้นี้มีอยู่ในระบบแล้ว' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await db.insert(users).values({
      username,
      passwordHash,
      displayName: displayName || username,
      role: userRole,
    }).returning({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
    });

    return { success: true, user: result[0] };
  });

  // -------------------------------------------------------
  // DELETE /auth/users/:id — ลบ User (admin only)
  // -------------------------------------------------------
  app.delete('/auth/users/:id', { preHandler: [verifyToken, requirePermission('manage_users')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = parseInt(id);

    const user = req.user as AuthUser;

    // ห้ามลบตัวเอง
    if (userId === user.userId) {
      return reply.status(400).send({ message: 'ไม่สามารถลบบัญชีตัวเองได้' });
    }

    const existing = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (existing.length === 0) {
      return reply.status(404).send({ message: 'ไม่พบผู้ใช้' });
    }

    await db.delete(users).where(eq(users.id, userId));
    return { success: true, message: 'ลบผู้ใช้สำเร็จ' };
  });
}

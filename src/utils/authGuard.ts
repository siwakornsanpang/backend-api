// src/utils/authGuard.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db';
import { permissions, rolePermissions } from '../db/schema';
import { eq } from 'drizzle-orm';

// Type สำหรับข้อมูล User ที่ถอดรหัสจาก JWT
export interface AuthUser {
  userId: number;
  role: string;
  displayName: string;
}

// ขยาย Type ของ @fastify/jwt ให้ใช้ AuthUser
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUser;
    user: AuthUser;
  }
}

/**
 * Middleware: ตรวจสอบ JWT Token
 */
export async function verifyToken(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({
      message: 'Unauthorized: Token ไม่ถูกต้องหรือหมดอายุ'
    });
  }
}

/**
 * Middleware Factory: ตรวจสอบ Role (เก็บไว้สำหรับ backward compatibility)
 */
export function requireRole(...roles: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as AuthUser;

    if (!user) {
      return reply.status(401).send({
        message: 'Unauthorized: ไม่พบข้อมูลผู้ใช้'
      });
    }

    if (!roles.includes(user.role)) {
      return reply.status(403).send({
        message: `Forbidden: สิทธิ์ "${user.role}" ไม่สามารถทำรายการนี้ได้`
      });
    }
  };
}

/**
 * Middleware Factory: ตรวจสอบ Permission จาก DB
 * ใช้หลัง verifyToken เท่านั้น
 * admin → ผ่านทุก permission อัตโนมัติ
 * role อื่น → เช็คจาก role_permissions table
 */
export function requirePermission(...permissionKeys: string[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = request.user as AuthUser;

    if (!user) {
      return reply.status(401).send({
        message: 'Unauthorized: ไม่พบข้อมูลผู้ใช้'
      });
    }

    // admin ผ่านทุก permission
    if (user.role === 'admin') return;

    // ดึง permissions ของ role จาก DB
    const userPerms = await db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.role, user.role));
    
    const userPermKeys = userPerms.map(p => p.permissionKey);

    // เช็คว่ามี permission ที่ต้องการอย่างน้อย 1 ตัว
    const hasPermission = permissionKeys.some(key => userPermKeys.includes(key));

    if (!hasPermission) {
      return reply.status(403).send({
        message: `Forbidden: ไม่มีสิทธิ์ "${permissionKeys.join(', ')}" สำหรับ role "${user.role}"`
      });
    }
  };
}


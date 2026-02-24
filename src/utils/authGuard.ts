// src/utils/authGuard.ts
import { FastifyRequest, FastifyReply } from 'fastify';

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
 * ดึง token จาก Authorization: Bearer <token>
 * ถ้าถูกต้อง → ใส่ข้อมูล user ลงใน request.user
 * ถ้าไม่ถูกต้อง → ส่ง 401 Unauthorized
 */
export async function verifyToken(request: FastifyRequest, reply: FastifyReply) {
  try {
    // @fastify/jwt จะ verify และใส่ user ให้อัตโนมัติ
    await request.jwtVerify();
  } catch (err) {
    return reply.status(401).send({
      message: 'Unauthorized: Token ไม่ถูกต้องหรือหมดอายุ'
    });
  }
}

/**
 * Middleware Factory: ตรวจสอบ Role
 * ใช้หลัง verifyToken เท่านั้น
 * ถ้า user.role อยู่ใน roles ที่อนุญาต → ผ่าน
 * ถ้าไม่ → ส่ง 403 Forbidden
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

// src/db/schema.ts
import { pgTable, serial, text, varchar, timestamp , integer, date } from 'drizzle-orm/pg-core';


export const pharmacists = pgTable('pharmacists', {
  id: serial('id').primaryKey(), // ID ตัวเลขรันอัตโนมัติ 1, 2, 3...
  firstName: varchar('first_name', { length: 256 }).notNull(),
  lastName: varchar('last_name', { length: 256 }).notNull(),
  licenseNumber: varchar('license_number', { length: 50 }).unique().notNull(), // เลขใบอนุญาตห้ามซ้ำ
  province: varchar('province', { length: 100 }),
  status: varchar('status', { length: 20 }).default('Active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// src/db/schema.ts (ต่อท้ายไฟล์เดิม)

// ตารางสำหรับเก็บข้อมูลหน้าแรก (ข้อความ + ลิงก์รูปที่อัปโหลดแล้ว)
export const homeContent = pgTable('home_content', {
  id: serial('id').primaryKey(),
  welcomeMessage: text('welcome_message'),
  bannerUrl: text('banner_url'), // เก็บ path ของไฟล์รูปที่เราอัปโหลด
  updatedAt: timestamp('updated_at').defaultNow(),
});


export const laws = pgTable('laws', {
  id: serial('id').primaryKey(),
  category: text('category').notNull(), // เก็บหมวดหมู่ (เช่น law1, law2)
  title: text('title').notNull(),       // ชื่อกฎหมาย
  announcedAt: date('announced_at'),    // วันที่ประกาศ
  order: integer('order').default(0),   // ลำดับการแสดงผล
  pdfUrl: text('pdf_url'),              // ลิงก์ไฟล์ PDF
  createdAt: timestamp('created_at').defaultNow(),
});
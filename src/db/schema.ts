// src/db/schema.ts

import { pgTable, serial, text, varchar, timestamp , integer, date, unique, boolean, json  } from 'drizzle-orm/pg-core';




// src/db/schema.ts (ต่อท้ายไฟล์เดิม)

// ตารางสำหรับเก็บข้อมูลหน้าแรก (ข้อความ + ลิงก์รูปที่อัปโหลดแล้ว)

type BannerItem = {
  id: string;
  url: string;
  active: boolean;
  order: number;
};

export const homeContent = pgTable('home_content', {
  id: serial('id').primaryKey(),

  // 2. ⚠️ แก้บรรทัดนี้ครับ (สำคัญมาก! ต้องเป็น BannerItem[] เท่านั้น)
  banners: json('banners').$type<BannerItem[]>().default([]), 
  
  headerText: text('header_text'),
  subHeaderText: text('sub_header_text'),
  bodyText: text('body_text'),
  popupImageUrl: text('popup_image_url'),
  showPopup: boolean('show_popup').default(true),
  updatedAt: timestamp('updated_at').defaultNow()
});

export const laws = pgTable('laws', {
  id: serial('id').primaryKey(),
  category: text('category').notNull(), // เก็บหมวดหมู่ (เช่น law1, law2)
  title: text('title').notNull(),       // ชื่อกฎหมาย
  announcedAt: date('announced_at'),    // วันที่ประกาศ
  order: integer('order').default(0),   // ลำดับการแสดงผล
  pdfUrl: text('pdf_url'),              // ลิงก์ไฟล์ PDF
  status: text('status').default('online'),
  createdAt: timestamp('created_at').defaultNow(),
});

// src/db/schema.ts


// ... ตารางอื่นๆ ...

// 🔥 ตารางกรรมการสภา
// src/db/schema.ts

// ... (ส่วนอื่นๆ เหมือนเดิม)

export const councilMembers = pgTable('council_members', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  position: text('position').notNull(),
  type: text('type').notNull(), 
  imageUrl: text('image_url'),
  order: integer('order').notNull(), 
  background: text('background'),
} 
// 🔥 ลบส่วน (t) => ({ unq: ... }) ตรงนี้ทิ้งไปเลยครับ ให้จบที่ปีกกาปิด } พอ
);


export const pharmacists = pgTable('pharmacists', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),           // ชื่อ-นามสกุล (ภักดี สุดหล่อ)
  registrationId: text('registration_id').notNull(), // เลขใบอนุญาต (ภ.77889)
  province: text('province'),             // จังหวัด (กรุงเทพ)
  status: text('status').default('ใช้งาน'), // สถานะ (ใช้งาน, ไม่ใช้งาน, พักใช้ใบอนุญาต)
  address: text('address'),                // ที่อยู่
  expiryDate: text('expiry_date'),         // วันหมดอายุ (เก็บเป็น text หรือ date ก็ได้ตามข้อมูลต้นทาง)
  imageUrl: text('image_url'),
});

export const news = pgTable('news', {
  id: serial('id').primaryKey(),
  order: integer('order').default(0).unique(),      // ลำดับการแสดงผล
  title: text('title').notNull(),               // หัวข้อข่าว
  content: text('content').notNull(),           // เนื้อหาข่าว
  status: text('status').default('draft'), // สถานะ (draft, published)
  category: text('category').notNull(), // หมวดหมู่ข่าว (news, activity, announcement)
  // images: json('images').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow(),     // วันที่สร้าง
  updatedAt: timestamp('updated_at').defaultNow(),     // วันที่แก้ไขล่าสุด
  publishedAt: timestamp('published_at').defaultNow(), // วันที่เผยแพร่
});


export const councilHistory = pgTable('council_history', {
  id: serial('id').primaryKey(),
  term: text('term').notNull(),           // 1. วาระ (เช่น "13")
  years: text('years').notNull(),         // 2. ปีที่ดำรงตำแหน่ง (เช่น "2568-2570")
  presidentName: text('president_name').notNull(), // 3. ชื่อนายก
  secretaryName: text('secretary_name').notNull(), // 4. ชื่อเลขา
  presidentImage: text('president_image'),         // 5. รูปนายก
  secretaryImage: text('secretary_image'),         // 6. รูปเลขา
  createdAt: timestamp('created_at').defaultNow(),
});

export const agencies = pgTable('agencies', {
  id: serial('id').primaryKey(),
  category: text('category').notNull(),      // 'secretary', 'royal_college', 'supervised'
  name: text('name').notNull(),              // ชื่อหน่วยงาน
  description: text('description'),          // 🔥 เพิ่ม: คำอธิบายสั้นๆ
  imageUrl: text('image_url'),               // 🔥 เพิ่ม: Logo หน่วยงาน
  url: text('url').notNull(),                // ลิงก์เว็บไซต์
  status: text('status').default('online'),  
  order: integer('order').default(0),        
  createdAt: timestamp('created_at').defaultNow(),
});
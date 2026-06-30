// src/routes/products.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { products, permissions, rolePermissions } from '../db/schema';
import { eq, desc, and, like } from 'drizzle-orm';
import { verifyToken, requirePermission } from '../utils/authGuard';
import { streamToBuffer, uploadToStorage, deleteFromStorage, getFilePathFromUrl } from '../utils/upload';
import { supabase } from '../utils/supabase';

export async function productsRoutes(app: FastifyInstance) {

  // Self-healing check: Ensure manage_product permission exists in DB
  try {
    const existingPerm = await db.select().from(permissions).where(eq(permissions.key, 'manage_product')).limit(1);
    if (existingPerm.length === 0) {
      console.log('🌱 Seeding manage_product permission...');
      await db.insert(permissions).values({
        key: 'manage_product',
        label: 'จัดการสินค้า',
        group: 'เว็บไซต์',
        order: 8
      });
      // Automatically assign it to admin
      await db.insert(rolePermissions).values({
        role: 'admin',
        permissionKey: 'manage_product'
      });
      console.log('✅ Seeding manage_product permission completed.');
    }
  } catch (err) {
    console.error('❌ Error checking/seeding manage_product permission:', err);
  }

  // GET: ดึงสินค้าทั้งหมด
  app.get('/products', async (req, reply) => {
    const { category, search } = req.query as { category?: string; search?: string };
    const conditions = [];
    if (category) {
      conditions.push(eq(products.category, category));
    }
    if (search) {
      conditions.push(like(products.name, `%${search}%`));
    }

    const result = await db.select().from(products)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(products.createdAt));
    return result;
  });

  // GET: ดึงสินค้าตาม id
  app.get('/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await db.select().from(products).where(eq(products.id, parseInt(id))).limit(1);
    if (result.length === 0) return reply.status(404).send({ message: 'ไม่พบสินค้า' });
    return result[0];
  });

  // POST: Upload Image
  app.post('/products/upload-image', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (req, reply) => {
    try {
      const data = await req.file();
      if (!data) return reply.status(400).send({ message: 'No file uploaded' });

      const fileBuffer = await streamToBuffer(data.file);
      const url = await uploadToStorage('products', fileBuffer, data.filename, data.mimetype);

      if (!url) return reply.status(500).send({ message: 'Upload failed' });
      return { url };
    } catch (err) {
      console.error('Upload Error:', err);
      return reply.status(500).send({ message: 'Internal Server Error' });
    }
  });

  // POST: สร้างสินค้า
  app.post('/products', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (req, reply) => {
    const { name, imageUrl, category, description, price } = req.body as any;
    if (!name || !category || price === undefined) {
      return reply.status(400).send({ message: 'Name, category, and price are required' });
    }
    const result = await db.insert(products).values({
      name,
      imageUrl: imageUrl || null,
      category,
      description: description || null,
      price: price.toString(),
    }).returning();
    return { success: true, data: result[0] };
  });

  // PUT: แก้ไขสินค้า
  app.put('/products/:id', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { name, imageUrl, category, description, price } = req.body as any;

      const existing = await db.select().from(products).where(eq(products.id, parseInt(id))).limit(1);
      if (existing.length === 0) return reply.status(404).send({ message: 'Not found' });

      // ลบรูปภาพเก่าถ้ามีการเปลี่ยนรูป
      if (existing[0].imageUrl && existing[0].imageUrl !== imageUrl) {
        const filePath = getFilePathFromUrl(existing[0].imageUrl);
        if (filePath) {
          await supabase.storage.from('uploads').remove([filePath]);
        }
      }

      const result = await db.update(products)
        .set({
          name,
          imageUrl: imageUrl || null,
          category,
          description: description || null,
          price: price.toString(),
          updatedAt: new Date(),
        })
        .where(eq(products.id, parseInt(id)))
        .returning();

      return { success: true, data: result[0] };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to update product' });
    }
  });

  // DELETE: ลบสินค้า + ลบรูปจาก Storage
  app.delete('/products/:id', { preHandler: [verifyToken, requirePermission('manage_product')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const existing = await db.select().from(products).where(eq(products.id, parseInt(id))).limit(1);

      if (existing.length > 0 && existing[0].imageUrl) {
        const filePath = getFilePathFromUrl(existing[0].imageUrl);
        if (filePath) {
          await supabase.storage.from('uploads').remove([filePath]);
        }
      }

      await db.delete(products).where(eq(products.id, parseInt(id)));
      return { success: true, message: 'ลบสินค้าเรียบร้อย' };
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ message: 'Failed to delete product' });
    }
  });
}

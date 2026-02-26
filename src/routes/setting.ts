// src/routes/setting.ts
import { FastifyInstance } from 'fastify';
import { db } from '../db';
import { webSettings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { supabase } from '../utils/supabase';
import path from 'path';
import { verifyToken, requireRole } from '../utils/authGuard';

async function streamToBuffer(stream: any): Promise<Buffer> {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

export async function webSettingRoutes(app: FastifyInstance) {

    // GET: ดึงข้อมูลการตั้งค่าเว็บไซต์
    app.get('/web-settings', async () => {
        const settings = await db.select().from(webSettings).limit(1);

        if (settings.length === 0) {
            // คืนค่า default ถ้ายังไม่มีข้อมูลใน DB
            return {
                siteNameTh: 'สภาเภสัชกรรม',
                siteNameEn: 'The Pharmacy Council of Thailand',
                slogan: '',
                logoPath: '',
                address: '',
                phone: '',
                fax: '',
                email: '',
                googleMapsUrl: '',
                googleMapsEmbed: '',
                facebookUrl: '',
                lineId: '',
                youtubeUrl: ''
            };
        }

        return settings[0];
    });

    // POST: อัปเดตข้อมูลการตั้งค่าเว็บไซต์ 
    app.post('/web-settings', { preHandler: [verifyToken, requireRole('manage_web_settings')] }, async (req, reply) => {
        const parts = req.parts();

        let updateData: any = {
            updatedAt: new Date()
        };

        let logoUrl = '';
        let hasNewLogo = false;

        // 1. วนลูปรับไฟล์และข้อมูล
        for await (const part of parts) {
            if (part.type === 'file') {
                if (part.fieldname === 'logo') {
                    const ext = path.extname(part.filename);
                    const filename = `settings/logo_${Date.now()}${ext}`;
                    const fileBuffer = await streamToBuffer(part.file);

                    // Upload to Supabase
                    const { error } = await supabase.storage.from('uploads').upload(filename, fileBuffer, {
                        contentType: part.mimetype,
                        upsert: true
                    });

                    if (error) {
                        console.error('Upload Error:', error);
                        continue;
                    }

                    const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
                    logoUrl = data.publicUrl;
                    hasNewLogo = true;
                }
            } else {
                // จัดการข้อมูล Text Fields
                const fieldName = part.fieldname;
                const fieldValue = part.value as string;

                // Map field name จาก frontend (camelCase) เป็น DB (camelCase ใน schema)
                // หรือตามที่ schema กำหนดไว้
                updateData[fieldName] = fieldValue;
            }
        }

        if (hasNewLogo) {
            updateData.logoPath = logoUrl;
        }

        // 2. ตรวจสอบว่ามีข้อมูลเดิมอยู่แล้วหรือไม่ (Singleton)
        const existing = await db.select().from(webSettings).limit(1);

        if (existing.length > 0) {
            // Update
            await db.update(webSettings)
                .set(updateData)
                .where(eq(webSettings.id, existing[0].id));
        } else {
            // Insert (เฉพาะครั้งแรก)
            await db.insert(webSettings).values({
                ...updateData,
                id: 1 // บังคับ ID เป็น 1 สำหรับ Singleton
            });
        }

        return { success: true, logoUrl: hasNewLogo ? logoUrl : undefined };
    });
}

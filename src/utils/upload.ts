// ============================================
// Upload Helpers — แชร์ระหว่างทุก route file
// ============================================
import path from 'path';
import { supabase } from './supabase';

/** แปลง Stream เป็น Buffer สำหรับอัปโหลด */
export async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** ล้างชื่อไฟล์ให้ปลอดภัย (แปลงภาษาไทย/เว้นวรรค เป็น _) */
export function sanitizeFilename(originalName: string): string {
  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext);
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
  return `${safeName}${ext}`;
}

/** ดึง file path จาก Supabase public URL เพื่อใช้ลบ */
export function getFilePathFromUrl(url: string, bucketName: string = 'uploads'): string | null {
  if (!url) return null;
  const marker = `/${bucketName}/`;
  const parts = url.split(marker);
  if (parts.length < 2) return null;
  return parts[1];
}

/**
 * อัปโหลดไฟล์ขึ้น Supabase Storage
 * @param folder - โฟลเดอร์ย่อย (เช่น 'council', 'history', 'agencies')
 * @param fileBuffer - Buffer ของไฟล์
 * @param originalFilename - ชื่อไฟล์ต้นฉบับ
 * @param mimetype - MIME type
 * @param fieldname - ชื่อ field (ใช้เป็น prefix ถ้ามี)
 * @returns public URL ของไฟล์ที่อัปโหลด หรือ null ถ้าเกิดข้อผิดพลาด
 */
export async function uploadToStorage(
  folder: string,
  fileBuffer: Buffer,
  originalFilename: string,
  mimetype: string,
  fieldname?: string
): Promise<string | null> {
  const safeName = sanitizeFilename(originalFilename);
  const prefix = fieldname ? `${fieldname}_` : '';
  const filename = `${folder}/${Date.now()}_${prefix}${safeName}`;

  const { error } = await supabase.storage
    .from('uploads')
    .upload(filename, fileBuffer, { contentType: mimetype, upsert: true });

  if (error) {
    console.error(`❌ Upload Error (${folder}):`, error.message);
    return null;
  }

  const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
  return data.publicUrl;
}

/**
 * ลบไฟล์จาก Supabase Storage 
 * @param urls - array ของ public URL ที่ต้องการลบ
 */
export async function deleteFromStorage(urls: (string | null)[]): Promise<void> {
  const filePaths = urls
    .filter((url): url is string => !!url)
    .map((url) => getFilePathFromUrl(url))
    .filter((path): path is string => !!path);

  if (filePaths.length > 0) {
    const { error } = await supabase.storage.from('uploads').remove(filePaths);
    if (error) {
      console.error('❌ Failed to delete files:', error.message);
    }
  }
}

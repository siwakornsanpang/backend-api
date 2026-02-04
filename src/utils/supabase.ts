// src/utils/supabase.ts
import { createClient } from '@supabase/supabase-js';

// อ่านค่าจาก .env (หรือจาก Render Environment)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

// สร้างและส่งออกตัว Client ให้ไฟล์อื่นใช้
export const supabase = createClient(supabaseUrl, supabaseKey);
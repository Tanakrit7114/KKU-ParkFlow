# KKU ParkFlow — Vercel + Supabase

เวอร์ชัน Cloud ฟรี: GitHub เก็บโค้ด, Vercel deploy หน้าเว็บ และ Supabase ให้ Google OAuth, PostgreSQL และ private Storage ไม่ต้องเปิดเครื่องตัวเองรัน

## ตั้งค่า Supabase

1. สร้าง Project ใน Supabase
2. ไป SQL Editor แล้วรัน `supabase.sql`
3. เปิด Authentication → Providers → Google
4. เปิด `supabase-config.js` แล้วแทนค่า `YOUR_PROJECT` และ `YOUR_SUPABASE_ANON_KEY`
5. ตั้ง Supabase Auth Redirect URL เป็น `https://ชื่อโปรเจกต์.vercel.app/`
6. เพิ่ม URL เดียวกันใน Google Cloud OAuth Authorized redirect URLs

## Database / ER Diagram

ใช้ `supabase.sql` เป็น schema หลักสำหรับระบบที่ deploy อยู่บน Vercel + Supabase ดูความสัมพันธ์ของตารางได้ที่ [`docs/ER-DIAGRAM.md`](docs/ER-DIAGRAM.md) ส่วน `db/schema.sql` เป็น schema เก่าของ Express/PostgreSQL demo และไม่ควรนำไปรันปนกับ Supabase schema

## Push GitHub

```bash
cd /Users/tanakrit/Desktop/kku-parkflow
git add .
git commit -m "Deploy KKU ParkFlow with Supabase"
git push origin main
```

## Deploy Vercel

1. เข้า Vercel → Add New Project
2. Import repository `Tanakrit7114/KKU-ParkFlow`
3. กด Deploy
4. ทุกครั้งที่ push `main` Vercel จะ deploy อัตโนมัติ

ระบบจะอนุญาตเฉพาะ Google account ที่ลงท้ายด้วย `@kkumail.com` หรือ `@kku.ac.th`; ห้ามนำ `service_role key` ใส่ใน Frontend

## เชื่อม KKU IntelSphere วิเคราะห์ภาพ

โค้ดมี Edge Function ที่ชื่อ `analyze-report` แล้ว โดยจะอ่านภาพจาก Supabase Storage, ส่งไปยัง endpoint ของ KKU IntelSphere และบันทึก `ai_confidence` กับ `ai_flags` กลับไปที่ `reports` ระบบใช้รูปแบบ OpenAI-compatible multimodal (`/chat/completions`) เพื่อไม่เปิด Token ให้ Browser

ก่อนใช้งานจริงต้องมีข้อมูลจากผู้ดูแล KKU IntelSphere:

1. URL แบบเต็มของ endpoint ที่รับภาพ
2. API Token/วิธี Authentication
3. ชื่อโมเดลที่รองรับภาพ
4. Quota และนโยบายการเก็บภาพ

นำค่าไปใส่ใน Supabase Dashboard → Edge Functions → Secrets ในชื่อ `INTELSPHERE_API_URL`, `INTELSPHERE_API_KEY` และ `INTELSPHERE_MODEL` แล้ว deploy function ด้วย Supabase CLI:

```bash
supabase functions deploy analyze-report
```

ถ้ายังไม่ใส่ Secrets รายงานยังถูกบันทึกตามปกติ แต่จะยังไม่มีค่า AI confidence จนกว่าจะตั้งค่า endpoint สำเร็จ

## ข้อจำกัด

AI, email notification และ Admin actions ที่ใช้ secret ควรย้ายไป Supabase Edge Functions ก่อน production เพื่อไม่เปิด secret ให้ Browser และควรตรวจ PDPA ก่อนใช้ข้อมูลจริง

# KKU ParkFlow — Free deployment

ชุดนี้ใช้ GitHub เป็น source control และ Vercel เป็น hosting สำหรับ Express API + หน้าเว็บ

## ตั้งค่า Google OAuth และ PostgreSQL

1. สร้าง PostgreSQL ที่มี public connection string แล้วรัน `db/schema.sql`
2. สร้าง Google OAuth Web Client
3. Push repository นี้ขึ้น GitHub
4. เข้า Vercel → Add New Project → Import Git Repository → Deploy
5. เพิ่ม Environment Variables จาก `.env.example` ใน Vercel
6. ตั้ง `GOOGLE_REDIRECT_URI` เป็น `https://ชื่อโปรเจกต์.vercel.app/auth/google/callback`
7. เพิ่ม redirect URI เดียวกันใน Google Cloud OAuth

## Deploy ด้วย GitHub → Vercel

```bash
cd /Users/tanakrit/Desktop/kku-parkflow
git init
git add .
git commit -m "KKU parking report system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kku-parkflow.git
git push -u origin main
```

ไฟล์ `vercel.json` จะ route `/api/*` และ `/auth/*` ไปยัง Express serverless function ใน `api/index.js`

## การตรวจ KKU Mail

ระบบตรวจ email ที่ได้จาก Google/Supabase session เท่านั้น และอนุญาตเฉพาะ `@kkumail.com` หรือ `@kku.ac.th`; ไม่เชื่อค่า email ที่ผู้ใช้กรอกเอง

## หมายเหตุด้านความปลอดภัย

ต้องเปิด Row Level Security ตาม `supabase.sql`; Storage bucket เป็น private และ policy จำกัดโฟลเดอร์ตาม user ID. ก่อนใช้งานจริงกับข้อมูลส่วนบุคคล ควรเพิ่ม Edge Function สำหรับ AI/email/admin actions เพื่อไม่เปิด service role key ให้ Browser และให้มหาวิทยาลัยตรวจ PDPA

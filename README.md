# KKU ParkFlow — Vercel + Supabase

เวอร์ชัน Cloud ฟรี: GitHub เก็บโค้ด, Vercel deploy หน้าเว็บ และ Supabase ให้ Google OAuth, PostgreSQL และ private Storage ไม่ต้องเปิดเครื่องตัวเองรัน

## ตั้งค่า Supabase

1. สร้าง Project ใน Supabase
2. ไป SQL Editor แล้วรัน `supabase.sql`
3. เปิด Authentication → Providers → Google
4. เปิด `supabase-config.js` แล้วแทนค่า `YOUR_PROJECT` และ `YOUR_SUPABASE_ANON_KEY`
5. ตั้ง Supabase Auth Redirect URL เป็น `https://ชื่อโปรเจกต์.vercel.app/`
6. เพิ่ม URL เดียวกันใน Google Cloud OAuth Authorized redirect URLs

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

## ข้อจำกัด

AI, email notification และ Admin actions ที่ใช้ secret ควรย้ายไป Supabase Edge Functions ก่อน production เพื่อไม่เปิด secret ให้ Browser และควรตรวจ PDPA ก่อนใช้ข้อมูลจริง

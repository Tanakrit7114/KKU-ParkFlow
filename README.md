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

## โครงสร้างโครงการ

```text
public/                 หน้าเว็บและไฟล์ frontend
server/                 Express API และการส่งอีเมลจริง
api/                    entrypoint สำหรับ Vercel
supabase/               migrations และ Edge Functions
db/                     schema สำหรับโหมด Express/PostgreSQL เก่า
docs/                   เอกสารและ ER diagram
```

ไฟล์หน้าเว็บถูกแยกไว้ใน `public/` เพื่อไม่ปะปนกับ backend และ Supabase โดย Express/Vercel จะเสิร์ฟโฟลเดอร์นี้ให้อัตโนมัติ

## รันและตรวจโค้ดในเครื่อง

```bash
npm run dev
npm run check
```

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

## เชื่อม Hugging Face วิเคราะห์ภาพ

โค้ดมี Edge Function ที่ชื่อ `analyze-report` แล้ว โดยจะอ่านภาพจาก Supabase Storage, ส่งภาพไปยัง Hugging Face Inference Providers ด้วยโมเดล object detection และบันทึก `ai_confidence` กับ `ai_flags` กลับไปที่ `reports` โดยเก็บโทเคนไว้ใน Supabase Edge Function Secret เพื่อไม่เปิดคีย์ให้ Browser

ฟังก์ชันจะใช้ Object Detection เพื่อช่วยตรวจว่าภาพมีรถจักรยานยนต์หรือไม่ พร้อมแสดงวัตถุและคะแนนความมั่นใจให้ Admin เห็น ผลลัพธ์เป็นการคัดกรอง ไม่ใช่คำตัดสินลงโทษอัตโนมัติ และยังไม่สามารถยืนยันได้ว่าภาพเป็นภาพจริงหรือภาพกลั่นแกล้งแทนมนุษย์

สร้าง Hugging Face fine-grained token ที่อนุญาต `Make calls to Inference Providers` แล้วนำค่าไปใส่ใน Supabase Dashboard → Edge Functions → Secrets ในชื่อ `HF_TOKEN` จากนั้น deploy function ด้วย Supabase CLI:

ระบบใช้โมเดล `facebook/detr-resnet-50` เป็นค่าเริ่มต้น หากต้องการเปลี่ยนโมเดลให้เพิ่ม Secret ชื่อ `HF_MODEL_ID` โดยต้องเป็นโมเดลที่รองรับงาน `object-detection`

```bash
supabase functions deploy analyze-report
```

ถ้ายังไม่ใส่ `HF_TOKEN` รายงานยังถูกบันทึกตามปกติ แต่หน้า Admin จะแสดงว่า AI ใช้งานไม่ได้พร้อมเหตุผล และเปิดให้ Admin ตรวจหลักฐานเอง

## เปิดใช้งานอีเมลจริงก่อน production

การตัดสินใจของ Admin จะบันทึกผ่าน Supabase ส่วนการส่งอีเมลจริงทำงานผ่าน Vercel Node API ด้วย Nodemailer และ Gmail SMTP เพื่อรองรับ App Password ของ Google โดยหน้าเว็บจะไม่เห็นรหัสผ่าน

ตั้งค่า Environment Variables ใน Vercel:

- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USER` — บัญชี Google ที่สร้าง App Password
- `SMTP_PASSWORD` หรือ `SMTP_PASS` — App Password 16 หลักจาก Google
- `MAIL_FROM` — อีเมลผู้ส่งเดียวกับ `SMTP_USER`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — ค่าของโปรเจกต์ Supabase (ไม่ต้องใส่ Service Role Key)

Google ระบุว่า App Password ต้องเปิด 2-Step Verification ก่อน และบัญชีองค์กรอาจถูกผู้ดูแลปิดความสามารถนี้

จากนั้นเพิ่มทะเบียนรถและอีเมลเจ้าของรถในหน้า Admin review ระบบจะสร้างคิวและส่งอีเมลจริงไปยัง Gmail/อีเมลผู้รับเมื่อ Admin เลือก “ส่งอีเมลจริง” หาก provider ล้มเหลว ระบบจะเก็บสถานะ `FAILED` และให้ Admin กดส่งซ้ำได้

AI เป็นเพียงตัวช่วยคัดกรองภาพ ไม่ใช่คำตัดสินลงโทษอัตโนมัติ และควรตรวจ PDPA/สิทธิ์การเข้าถึงข้อมูลจริงก่อนใช้งานเต็มรูปแบบ

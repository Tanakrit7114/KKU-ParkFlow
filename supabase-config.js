import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Supabase URL and anon key are safe for browser use when Row Level Security is enabled.
// Never put the service_role key here.
const SUPABASE_URL='https://zjolbhatwstmxcojznyd.supabase.co';
const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpqb2xiaGF0d3N0bXhjb2p6bnlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzOTAzODgsImV4cCI6MjEwNDk2NjM4OH0.tOjynsGhBTiVz_czCYoW6ThZ6YjPUW4-JoTBaQJJp60';
const configured=!SUPABASE_URL.includes('YOUR_')&&!SUPABASE_ANON_KEY.includes('YOUR_');
const supabase=configured?createClient(SUPABASE_URL,SUPABASE_ANON_KEY):null;
const gate=document.querySelector('#login-gate'),error=document.querySelector('#login-error'),shell=document.querySelector('.shell');
window.startKKULogin=async()=>{if(!configured){error.textContent='ระบบกำลังตั้งค่า กรุณากลับมาใหม่ภายหลัง';return}await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{hd:'kkumail.com'}}})};
if(!configured){error.textContent='ระบบกำลังตั้งค่า กรุณากลับมาใหม่ภายหลัง';}
if(supabase){supabase.auth.onAuthStateChange(async(_event,session)=>{const user=session?.user;if(!user){gate.style.display='flex';shell.style.visibility='hidden';return}const email=(user.email||'').toLowerCase(),hd=user.user_metadata?.hd||user.app_metadata?.provider_metadata?.hd;if(!email.endsWith('@kkumail.com')&&!email.endsWith('@kku.ac.th')){await supabase.auth.signOut();error.textContent='อนุญาตเฉพาะ KKU Mail (@kkumail.com / @kku.ac.th)';return}window.currentKKUUser=user;gate.style.display='none';shell.style.visibility='visible';const p=document.querySelector('.profile small');if(p)p.textContent=email});}
window.saveCloudReport=async(report,file)=>{if(!supabase||!window.currentKKUUser)throw Error('ต้องตั้งค่า Supabase และเข้าสู่ระบบก่อน');let evidence_path=null;if(file){evidence_path=`${window.currentKKUUser.id}/${report.id}-${file.name}`;const up=await supabase.storage.from('evidence').upload(evidence_path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error}const {data,error:dbError}=await supabase.from('reports').insert({reporter_id:window.currentKKUUser.id,plate_number:report.plate_number||null,description:report.title,incident_datetime:new Date().toISOString(),evidence_path,status:'PENDING'}).select().single();if(dbError)throw dbError;return data};

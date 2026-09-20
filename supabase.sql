create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text not null, name text, role text not null default 'student' check (role in ('student','staff','admin','super_admin','tester')), created_at timestamptz default now());
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student','staff','admin','super_admin','tester'));
create table if not exists public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid not null references public.profiles(id), plate_number text, violation_type text, description text not null, incident_datetime timestamptz not null, latitude numeric, longitude numeric, evidence_path text, status text not null default 'PENDING' check (status in ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','REQUEST_INFO')), ai_confidence numeric, ai_flags jsonb default '[]', reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz default now());
alter table public.reports add column if not exists violation_type text;
alter table public.reports add column if not exists latitude numeric;
alter table public.reports add column if not exists longitude numeric;
alter table public.reports add column if not exists location text;
create table if not exists public.vehicle_registry (id uuid primary key default gen_random_uuid(), plate_number text unique not null, owner_name text not null, owner_email text, owner_user_id uuid references public.profiles(id), active boolean not null default true, created_at timestamptz default now());
create table if not exists public.penalty_rules (id uuid primary key default gen_random_uuid(), violation_type text unique not null, points integer not null default 0, fine_amount numeric not null default 0, threshold_points integer not null default 10, active boolean not null default true, created_at timestamptz default now());
create table if not exists public.penalties (id uuid primary key default gen_random_uuid(), vehicle_id uuid references public.vehicle_registry(id), report_id uuid not null references public.reports(id), rule_id uuid references public.penalty_rules(id), points integer not null default 0, fine_amount numeric not null default 0, reason text not null, created_at timestamptz default now());
alter table public.penalties add column if not exists rule_id uuid references public.penalty_rules(id);
create table if not exists public.appeals (id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id), appellant_id uuid not null references public.profiles(id), reason text not null, status text not null default 'PENDING' check (status in ('PENDING','UNDER_REVIEW','APPROVED','REJECTED')), decision_note text, decided_by uuid references public.profiles(id), decided_at timestamptz, created_at timestamptz default now());
create table if not exists public.audit_logs (id bigserial primary key, actor_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id uuid, metadata jsonb default '{}'::jsonb, created_at timestamptz default now());
create table if not exists public.notification_queue (id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id), recipient_email text, subject text not null, body text not null, status text not null default 'QUEUED' check (status in ('QUEUED','SENT','FAILED','NO_RECIPIENT')), created_at timestamptz default now(), sent_at timestamptz);
create table if not exists public.mock_gmail_contacts (id uuid primary key default gen_random_uuid(), email text not null, display_name text not null, active boolean not null default true, created_by uuid references public.profiles(id), created_at timestamptz not null default now());
create unique index if not exists mock_gmail_contacts_email_idx on public.mock_gmail_contacts (lower(email));
create table if not exists public.mock_gmail_messages (id uuid primary key default gen_random_uuid(), report_id uuid references public.reports(id) on delete set null, recipient_email text not null, recipient_name text, subject text not null, body text not null, status text not null default 'SENT' check (status in ('DRAFT','SENT','FAILED')), sent_by uuid references public.profiles(id), sent_at timestamptz, created_at timestamptz not null default now());
create index if not exists mock_gmail_messages_sent_at_idx on public.mock_gmail_messages (sent_at desc);
create or replace function public.is_admin() returns boolean language sql security definer set search_path = public as $$ select exists (select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')); $$;
create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$ declare user_email text := lower(coalesce(new.email,'')); user_name text := coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',split_part(user_email,'@',1)); user_role text := case when user_email='tanakritk21@gmail.com' then 'tester' when user_email like '%@kku.ac.th' then 'staff' else 'student' end; begin insert into public.profiles(id,email,name,role) values(new.id,user_email,user_name,user_role) on conflict(id) do update set email=excluded.email,name=coalesce(nullif(excluded.name,''),public.profiles.name); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();
insert into public.profiles(id,email,name,role) select u.id,lower(u.email),coalesce(u.raw_user_meta_data->>'full_name',u.raw_user_meta_data->>'name',split_part(lower(u.email),'@',1)),case when lower(u.email)='tanakritk21@gmail.com' then 'tester' when lower(u.email) like '%@kku.ac.th' then 'staff' else 'student' end from auth.users u left join public.profiles p on p.id=u.id where p.id is null and u.email is not null and (lower(u.email) like '%@kkumail.com' or lower(u.email) like '%@kku.ac.th' or lower(u.email)='tanakritk21@gmail.com') on conflict(id) do nothing;
create or replace function public.decide_report(p_report_id uuid,p_status text,p_action text default 'NONE',p_note text default '') returns jsonb language plpgsql security definer set search_path=public as $$ declare v_report public.reports%rowtype; v_rule public.penalty_rules%rowtype; v_vehicle public.vehicle_registry%rowtype; v_recipient text; v_result text:='บันทึกผลตรวจสอบแล้ว'; v_action text:=coalesce(nullif(p_action,''),'NONE'); begin if not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')) then raise exception 'Forbidden'; end if; if p_status not in ('APPROVED','REJECTED','REQUEST_INFO') then raise exception 'Invalid report status'; end if; if v_action not in ('NONE','EMAIL','PENALTY') then raise exception 'Invalid report action'; end if; select * into v_report from public.reports where id=p_report_id for update; if not found then raise exception 'Report not found'; end if; if v_report.status not in ('PENDING','UNDER_REVIEW') then raise exception 'Report has already been decided'; end if; update public.reports set status=p_status,reviewed_by=auth.uid(),reviewed_at=now() where id=p_report_id; if p_status='APPROVED' and v_action='PENALTY' then select * into v_rule from public.penalty_rules where violation_type=coalesce(v_report.violation_type,'') and active=true limit 1; if v_report.plate_number is not null then select * into v_vehicle from public.vehicle_registry where plate_number=v_report.plate_number and active=true limit 1; end if; if not exists(select 1 from public.penalties where report_id=p_report_id) then insert into public.penalties(vehicle_id,report_id,rule_id,points,fine_amount,reason) values(v_vehicle.id,p_report_id,v_rule.id,coalesce(v_rule.points,5),coalesce(v_rule.fine_amount,0),coalesce(nullif(p_note,''),'ยืนยันการจอดรถจักรยานยนต์ผิดระเบียบ')); end if; v_result:='ยืนยันและสร้างบทลงโทษแล้ว'; elsif p_status='APPROVED' and v_action='EMAIL' then if v_report.plate_number is not null then select owner_email into v_recipient from public.vehicle_registry where plate_number=v_report.plate_number and active=true limit 1; end if; insert into public.notification_queue(report_id,recipient_email,subject,body,status) values(p_report_id,v_recipient,'แจ้งผลการตรวจสอบการจอดรถจักรยานยนต์ KKU ParkFlow',format(E'ผลการตรวจสอบ: %s\nรายละเอียดเพิ่มเติม: %s\nช่องทางอุทธรณ์: ติดต่อหน่วยงานดูแลพื้นที่ของมหาวิทยาลัย',v_report.description,coalesce(nullif(p_note,''),'-')),case when v_recipient is null then 'NO_RECIPIENT' else 'QUEUED' end); v_result:=case when v_recipient is null then 'ยืนยันแล้ว แต่ยังไม่พบอีเมลผู้รับ จึงยังส่ง Gmail ไม่ได้' else 'ยืนยันและเข้าคิวส่ง Gmail แล้ว' end; end if; insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'REPORT_DECISION','report',p_report_id,jsonb_build_object('status',p_status,'action',v_action,'note',coalesce(p_note,''),'follow_up',v_result)); return jsonb_build_object('result',v_result,'report_id',p_report_id,'status',p_status); end; $$;
grant execute on function public.decide_report(uuid,text,text,text) to authenticated;
alter table public.vehicle_registry enable row level security; alter table public.penalty_rules enable row level security; alter table public.penalties enable row level security; alter table public.appeals enable row level security; alter table public.audit_logs enable row level security; alter table public.notification_queue enable row level security;
alter table public.mock_gmail_contacts enable row level security; alter table public.mock_gmail_messages enable row level security;
create policy "admins manage vehicle registry" on public.vehicle_registry for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage penalty rules" on public.penalty_rules for all using (public.is_admin()) with check (public.is_admin());
create policy "admins manage penalties" on public.penalties for all using (public.is_admin()) with check (public.is_admin());
create policy "users read own penalties" on public.penalties for select using (exists (select 1 from public.vehicle_registry v where v.id=vehicle_id and v.owner_user_id=auth.uid()) or public.is_admin());
create policy "users create own appeals" on public.appeals for insert with check (auth.uid()=appellant_id);
create policy "users read own appeals" on public.appeals for select using (auth.uid()=appellant_id or public.is_admin());
create policy "admins manage appeals" on public.appeals for update using (public.is_admin()) with check (public.is_admin());
create policy "admins read audit logs" on public.audit_logs for select using (public.is_admin());
create policy "admins create audit logs" on public.audit_logs for insert with check (public.is_admin());
create policy "admins manage notification queue" on public.notification_queue for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage mock gmail contacts" on public.mock_gmail_contacts;
create policy "admins manage mock gmail contacts" on public.mock_gmail_contacts for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins manage mock gmail messages" on public.mock_gmail_messages;
create policy "admins manage mock gmail messages" on public.mock_gmail_messages for all using (public.is_admin()) with check (public.is_admin());
insert into public.penalty_rules (violation_type,points,fine_amount,threshold_points) values ('จอดรถกีดขวาง / ผิดพื้นที่',5,0,10),('จอดขวางทางเข้าออก',5,0,10),('จอดบนทางเท้า',5,0,10),('จอดกีดขวางรถคันอื่น',5,0,10) on conflict (violation_type) do nothing;
alter table public.profiles enable row level security; alter table public.reports enable row level security;
create or replace function public.is_admin() returns boolean language sql security definer set search_path = public as $$ select exists (select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')); $$;
create policy "users read own profile" on public.profiles for select using (auth.uid()=id);
drop policy if exists "admins read reporter profiles" on public.profiles;
create policy "admins read reporter profiles" on public.profiles for select using (public.is_admin());
create policy "users create own profile" on public.profiles for insert with check (auth.uid()=id);
create policy "users update own profile" on public.profiles for update using (auth.uid()=id) with check (auth.uid()=id);
create or replace function public.prevent_role_escalation() returns trigger language plpgsql security definer set search_path = public as $$ begin if old.role is distinct from new.role and current_user not in ('postgres','supabase_admin') and coalesce(auth.role(),'') <> 'service_role' then raise exception 'role can only be changed by a server administrator'; end if; return new; end; $$;
drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard before update on public.profiles for each row execute function public.prevent_role_escalation();
create policy "users read own reports" on public.reports for select using (auth.uid()=reporter_id);
create policy "users create own reports" on public.reports for insert with check (auth.uid()=reporter_id);
create policy "admins read all reports" on public.reports for select using (public.is_admin());
create policy "admins update reports" on public.reports for update using (public.is_admin()) with check (public.is_admin());
insert into storage.buckets(id,name,public) values('evidence','evidence',false) on conflict(id) do nothing;
create policy "users upload own evidence" on storage.objects for insert to authenticated with check (bucket_id='evidence' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users read own evidence" on storage.objects for select to authenticated using (bucket_id='evidence' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "admins read all evidence" on storage.objects;
create policy "admins read all evidence" on storage.objects for select to authenticated using (bucket_id='evidence' and public.is_admin());
-- Keep the one-file bootstrap schema aligned with the production migration.
-- This override sends reporter progress emails and deducts five points per approved report.
+-- Notify the reporter about an admin decision and apply five points per approved report.
-- Email delivery remains queued so the existing SMTP sender can retry safely.
create or replace function public.decide_report(
  p_report_id uuid,
  p_status text,
  p_action text default 'NONE',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report public.reports%rowtype;
  v_rule public.penalty_rules%rowtype;
  v_vehicle public.vehicle_registry%rowtype;
  v_reporter_email text;
  v_reporter_name text;
  v_owner_email text;
  v_result text := 'บันทึกผลตรวจสอบแล้ว';
  v_action text := coalesce(nullif(p_action, ''), 'NONE');
  v_status_label text;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'super_admin')
  ) then
    raise exception 'Forbidden';
  end if;
  if p_status not in ('APPROVED', 'REJECTED', 'REQUEST_INFO') then
    raise exception 'Invalid report status';
  end if;
  if v_action not in ('NONE', 'EMAIL', 'PENALTY') then
    raise exception 'Invalid report action';
  end if;

  select * into v_report
  from public.reports
  where id = p_report_id
  for update;
  if not found then raise exception 'Report not found'; end if;
  if v_report.status not in ('PENDING', 'UNDER_REVIEW') then
    raise exception 'Report has already been decided';
  end if;

  select email, name into v_reporter_email, v_reporter_name
  from public.profiles
  where id = v_report.reporter_id;

  if v_report.plate_number is not null then
    select * into v_vehicle
    from public.vehicle_registry
    where plate_number = v_report.plate_number and active = true
    limit 1;
    v_owner_email := v_vehicle.owner_email;
  end if;

  update public.reports
  set status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_report_id;

  if p_status = 'APPROVED' then
    select * into v_rule from public.penalty_rules
    where violation_type = coalesce(v_report.violation_type, '') and active = true
    limit 1;

    -- One approved report equals one round and always deducts five points.
    if not exists (select 1 from public.penalties where report_id = p_report_id) then
      insert into public.penalties (vehicle_id, report_id, rule_id, points, fine_amount, reason)
      values (
        v_vehicle.id,
        p_report_id,
        v_rule.id,
        5,
        coalesce(v_rule.fine_amount, 0),
        coalesce(nullif(p_note, ''), 'ยืนยันการจอดรถจักรยานยนต์ผิดระเบียบ')
      );
    end if;
    v_result := 'ยืนยันรายงานและหัก 5 คะแนนแล้ว';
  elsif p_status = 'REJECTED' then
    v_status_label := 'ไม่เข้าเกณฑ์';
  else
    v_status_label := 'ขอข้อมูลเพิ่มเติม';
  end if;

  if p_status = 'APPROVED' then
    v_status_label := 'ตรวจสอบแล้ว · หัก 5 คะแนน';
  end if;

  if v_action = 'EMAIL' then
    if v_reporter_email is not null then
      insert into public.notification_queue (report_id, recipient_email, subject, body, status)
      values (
        p_report_id,
        v_reporter_email,
        'อัปเดตความคืบหน้ารายงาน KKU ParkFlow',
        format(E'เรียนคุณ %s\n\nรายงานของคุณได้รับการอัปเดตแล้ว\nสถานะ: %s\nรายละเอียด: %s\n\nระบบได้บันทึกความคืบหน้าไว้ในบัญชีของคุณแล้ว%s\n\nหากต้องการสอบถามเพิ่มเติม กรุณาติดต่อหน่วยงานดูแลพื้นที่ของมหาวิทยาลัย',
          coalesce(nullif(v_reporter_name, ''), 'ผู้รายงาน'),
          v_status_label,
          v_report.description,
          case when p_status = 'APPROVED' then E'\nหักคะแนน: 5 คะแนนต่อรอบ' else '' end),
        'QUEUED'
      );
    end if;

    -- Keep the existing owner notification, but avoid sending the same email twice.
    if v_owner_email is not null and lower(v_owner_email) <> lower(coalesce(v_reporter_email, '')) then
      insert into public.notification_queue (report_id, recipient_email, subject, body, status)
      values (
        p_report_id,
        v_owner_email,
        'แจ้งผลการตรวจสอบการจอดรถจักรยานยนต์ KKU ParkFlow',
        format(E'ผลการตรวจสอบ: %s\nสถานะ: %s\nรายละเอียดเพิ่มเติม: %s', v_report.description, v_status_label, coalesce(nullif(p_note, ''), '-')),
        'QUEUED'
      );
    end if;

    v_result := v_result || ' และเข้าคิวส่งอีเมลแจ้งผู้รายงานแล้ว';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'REPORT_DECISION',
    'report',
    p_report_id,
    jsonb_build_object(
      'status', p_status,
      'action', v_action,
      'note', coalesce(p_note, ''),
      'follow_up', v_result,
      'reporter_notified', v_action = 'EMAIL',
      'points_deducted', case when p_status = 'APPROVED' then 5 else 0 end
    )
  );
  return jsonb_build_object('result', v_result, 'report_id', p_report_id, 'status', p_status);
end;
$$;

grant execute on function public.decide_report(uuid, text, text, text) to authenticated;

-- Keep report validation and evidence storage policies aligned with production.
create or replace function public.normalize_report_plate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.plate_number is not null then
    new.plate_number := nullif(btrim(regexp_replace(new.plate_number, '\s+', ' ', 'g')), '');
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_report_plate_before_write on public.reports;
create trigger normalize_report_plate_before_write
before insert or update of plate_number on public.reports
for each row execute function public.normalize_report_plate();

drop trigger if exists normalize_vehicle_plate_before_write on public.vehicle_registry;
create trigger normalize_vehicle_plate_before_write
before insert or update of plate_number on public.vehicle_registry
for each row execute function public.normalize_report_plate();

create or replace function public.validate_new_report()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(new.description), '') is null then raise exception 'รายละเอียดรายงานจำเป็นต้องระบุ'; end if;
  if new.evidence_path is null or btrim(new.evidence_path) = '' then raise exception 'หลักฐานภาพถ่ายจำเป็นต้องแนบ'; end if;
  if new.latitude is null or new.longitude is null then raise exception 'กรุณาระบุตำแหน่งเกิดเหตุ'; end if;
  if new.latitude < -90 or new.latitude > 90 or new.longitude < -180 or new.longitude > 180 then raise exception 'พิกัดตำแหน่งไม่ถูกต้อง'; end if;
  if new.incident_datetime > now() then raise exception 'วันเวลาที่พบเห็นต้องไม่เป็นอนาคต'; end if;
  if new.incident_datetime < now() - interval '30 days' then raise exception 'วันเวลาที่พบเห็นเกิน 30 วัน'; end if;
  return new;
end;
$$;

drop trigger if exists validate_new_report_before_insert on public.reports;
create trigger validate_new_report_before_insert
before insert on public.reports
for each row execute function public.validate_new_report();

insert into storage.buckets(id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do update set public = false;

drop policy if exists "users upload own evidence" on storage.objects;
create policy "users upload own evidence" on storage.objects for insert to authenticated
with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users read own evidence" on storage.objects;
create policy "users read own evidence" on storage.objects for select to authenticated
using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "users delete own evidence" on storage.objects;
create policy "users delete own evidence" on storage.objects for delete to authenticated
using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "admins read all evidence" on storage.objects;
create policy "admins read all evidence" on storage.objects for select to authenticated
using (bucket_id = 'evidence' and public.is_admin());

-- Delete reports and dependent records automatically after two years.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.purge_expired_reports()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare deleted_count integer := 0;
begin
  create temp table if not exists expired_report_ids (id uuid primary key) on commit drop;
  truncate expired_report_ids;
  insert into expired_report_ids (id)
  select id from public.reports where created_at < now() - interval '2 years';
  delete from storage.objects where bucket_id = 'evidence' and name in (select evidence_path from public.reports where id in (select id from expired_report_ids) and evidence_path is not null);
  delete from public.notification_queue where report_id in (select id from expired_report_ids);
  delete from public.appeals where report_id in (select id from expired_report_ids);
  delete from public.penalties where report_id in (select id from expired_report_ids);
  delete from public.audit_logs where entity_type = 'report' and entity_id in (select id from expired_report_ids);
  delete from public.reports where id in (select id from expired_report_ids);
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_reports() from public;
grant execute on function public.purge_expired_reports() to service_role;
do $$ declare existing_job record; begin
  for existing_job in select jobid from cron.job where jobname = 'kku-parkflow-purge-expired-reports' loop perform cron.unschedule(existing_job.jobid); end loop;
  perform cron.schedule('kku-parkflow-purge-expired-reports', '0 18 * * *', 'select public.purge_expired_reports();');
end $$;

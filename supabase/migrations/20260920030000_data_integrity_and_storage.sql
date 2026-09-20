-- Enforce report integrity at the database boundary and align evidence storage policies.
-- This migration is idempotent and keeps direct API writes consistent with the UI.

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
  if nullif(btrim(new.description), '') is null then
    raise exception 'รายละเอียดรายงานจำเป็นต้องระบุ';
  end if;
  if new.evidence_path is null or btrim(new.evidence_path) = '' then
    raise exception 'หลักฐานภาพถ่ายจำเป็นต้องแนบ';
  end if;
  if new.latitude is null or new.longitude is null then
    raise exception 'กรุณาระบุตำแหน่งเกิดเหตุ';
  end if;
  if new.latitude < -90 or new.latitude > 90 or new.longitude < -180 or new.longitude > 180 then
    raise exception 'พิกัดตำแหน่งไม่ถูกต้อง';
  end if;
  if new.incident_datetime > now() then
    raise exception 'วันเวลาที่พบเห็นต้องไม่เป็นอนาคต';
  end if;
  if new.incident_datetime < now() - interval '30 days' then
    raise exception 'วันเวลาที่พบเห็นเกิน 30 วัน';
  end if;
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
create policy "users upload own evidence"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users read own evidence" on storage.objects;
create policy "users read own evidence"
  on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own evidence" on storage.objects;
create policy "users delete own evidence"
  on storage.objects for delete to authenticated
  using (bucket_id = 'evidence' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "admins read all evidence" on storage.objects;
create policy "admins read all evidence"
  on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.is_admin());

-- Create a profile automatically when a new Supabase Auth user is created.
-- This keeps first login reliable on a new device and avoids a client-side insert race.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_email text := lower(coalesce(new.email, ''));
  user_name text := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(user_email, '@', 1)
  );
  user_role text := case
    when user_email = 'tanakritk21@gmail.com' then 'tester'
    when user_email like '%@kku.ac.th' then 'staff'
    else 'student'
  end;
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, user_email, user_name, user_role)
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(nullif(excluded.name, ''), public.profiles.name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Backfill profiles for Auth users created before this trigger was installed.
insert into public.profiles (id, email, name, role)
select
  u.id,
  lower(u.email),
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(lower(u.email), '@', 1)),
  case
    when lower(u.email) = 'tanakritk21@gmail.com' then 'tester'
    when lower(u.email) like '%@kku.ac.th' then 'staff'
    else 'student'
  end
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
  and u.email is not null
  and (lower(u.email) like '%@kkumail.com' or lower(u.email) like '%@kku.ac.th' or lower(u.email) = 'tanakritk21@gmail.com')
on conflict (id) do nothing;

-- Keep Admin decisions atomic: status, penalty/notification follow-up, and audit log
-- must either all succeed or all roll back together.
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
  v_recipient text;
  v_result text := 'บันทึกผลตรวจสอบแล้ว';
  v_action text := coalesce(nullif(p_action, ''), 'NONE');
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

  select * into v_report from public.reports where id = p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if v_report.status not in ('PENDING', 'UNDER_REVIEW') then
    raise exception 'Report has already been decided';
  end if;

  update public.reports
  set status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_report_id;

  if p_status = 'APPROVED' and v_action = 'PENALTY' then
    select * into v_rule from public.penalty_rules
    where violation_type = coalesce(v_report.violation_type, '') and active = true
    limit 1;
    if v_report.plate_number is not null then
      select * into v_vehicle from public.vehicle_registry
      where plate_number = v_report.plate_number and active = true limit 1;
    end if;
    if not exists (select 1 from public.penalties where report_id = p_report_id) then
      insert into public.penalties (vehicle_id, report_id, rule_id, points, fine_amount, reason)
      values (v_vehicle.id, p_report_id, v_rule.id, coalesce(v_rule.points, 5), coalesce(v_rule.fine_amount, 0), coalesce(nullif(p_note, ''), 'ยืนยันการจอดรถจักรยานยนต์ผิดระเบียบ'));
    end if;
    v_result := 'ยืนยันและสร้างบทลงโทษแล้ว';
  elsif p_status = 'APPROVED' and v_action = 'EMAIL' then
    if v_report.plate_number is not null then
      select owner_email into v_recipient from public.vehicle_registry
      where plate_number = v_report.plate_number and active = true limit 1;
    end if;
    insert into public.notification_queue (report_id, recipient_email, subject, body, status)
    values (p_report_id, v_recipient, 'แจ้งผลการตรวจสอบการจอดรถจักรยานยนต์ KKU ParkFlow',
      format(E'ผลการตรวจสอบ: %s\nรายละเอียดเพิ่มเติม: %s\nช่องทางอุทธรณ์: ติดต่อหน่วยงานดูแลพื้นที่ของมหาวิทยาลัย', v_report.description, coalesce(nullif(p_note, ''), '-')),
      case when v_recipient is null then 'NO_RECIPIENT' else 'QUEUED' end);
    v_result := case when v_recipient is null then 'ยืนยันแล้ว แต่ยังไม่พบอีเมลผู้รับ จึงยังส่ง Gmail ไม่ได้' else 'ยืนยันและเข้าคิวส่ง Gmail แล้ว' end;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'REPORT_DECISION', 'report', p_report_id,
    jsonb_build_object('status', p_status, 'action', v_action, 'note', coalesce(p_note, ''), 'follow_up', v_result));
  return jsonb_build_object('result', v_result, 'report_id', p_report_id, 'status', p_status);
end;
$$;

grant execute on function public.decide_report(uuid, text, text, text) to authenticated;

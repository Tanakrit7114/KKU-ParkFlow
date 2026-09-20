-- Notify the reporter about an admin decision and apply five points per approved report.
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

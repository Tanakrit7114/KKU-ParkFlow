-- Give the vehicle owner a 30-minute warning before applying points.
-- Reports without a plate are escalated for a manual patrol and are never
-- penalized automatically because they cannot be tied to an owner safely.

alter table public.reports add column if not exists warning_sent_at timestamptz;
alter table public.reports add column if not exists warning_deadline timestamptz;
alter table public.reports add column if not exists penalty_applied_at timestamptz;
alter table public.reports add column if not exists enforcement_status text not null default 'PENDING';

update public.reports
set enforcement_status = case
  when penalty_applied_at is not null then 'PENALTY_APPLIED'
  when status = 'REJECTED' then 'CLOSED_NO_PENALTY'
  else coalesce(nullif(enforcement_status, ''), 'PENDING')
end
where enforcement_status is null or enforcement_status = '';

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
  ) then raise exception 'Forbidden'; end if;

  if p_status not in ('APPROVED', 'REJECTED', 'REQUEST_INFO', 'UNDER_REVIEW') then
    raise exception 'Invalid report status';
  end if;
  if v_action not in ('NONE', 'WARNING', 'PENALTY') then
    raise exception 'Invalid report action';
  end if;

  select * into v_report from public.reports
  where id = p_report_id for update;
  if not found then raise exception 'Report not found'; end if;
  if v_report.status not in ('PENDING', 'UNDER_REVIEW') then
    raise exception 'Report has already been decided';
  end if;

  select email, name into v_reporter_email, v_reporter_name
  from public.profiles where id = v_report.reporter_id;

  if v_report.plate_number is not null then
    select * into v_vehicle from public.vehicle_registry
    where plate_number = v_report.plate_number and active = true limit 1;
    v_owner_email := v_vehicle.owner_email;
  end if;

  -- No plate means no safe owner match. Escalate for a patrol instead of
  -- assigning points to an unrelated person.
  if v_report.plate_number is null and (v_action in ('WARNING', 'PENALTY') or p_status = 'APPROVED') then
    update public.reports
    set status = 'UNDER_REVIEW', enforcement_status = 'NO_PLATE_ESCALATED',
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_report_id;
    v_result := 'ไม่มีป้ายทะเบียน — ส่งให้เจ้าหน้าที่ตรวจพื้นที่ทันที และยังไม่หักคะแนน';
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'NO_PLATE_ESCALATION', 'report', p_report_id,
      jsonb_build_object('note', coalesce(p_note, ''), 'points_deducted', 0));
    return jsonb_build_object('result', v_result, 'report_id', p_report_id,
      'status', 'UNDER_REVIEW', 'enforcement_status', 'NO_PLATE_ESCALATED');
  end if;

  -- First step: warn the registered owner and start the 30-minute clock.
  if v_action = 'WARNING' then
    if p_status <> 'UNDER_REVIEW' then raise exception 'Warning must keep report under review'; end if;
    if v_report.warning_sent_at is not null then
      return jsonb_build_object('result', 'ส่งคำเตือน 30 นาทีไปแล้ว', 'report_id', p_report_id,
        'status', 'UNDER_REVIEW', 'enforcement_status', 'WARNING_SENT');
    end if;
    update public.reports
    set status = 'UNDER_REVIEW', warning_sent_at = now(),
        warning_deadline = now() + interval '30 minutes', enforcement_status = 'WARNING_SENT'
    where id = p_report_id;
    if v_owner_email is not null then
      insert into public.notification_queue(report_id, recipient_email, subject, body, status)
      values (p_report_id, v_owner_email, 'แจ้งเตือนให้เคลื่อนย้ายรถภายใน 30 นาที KKU ParkFlow',
        format(E'เรียนเจ้าของรถทะเบียน %s\n\nพบรายงานรถจอดกีดขวางหรือผิดพื้นที่ กรุณาเคลื่อนย้ายรถภายใน 30 นาที\nสถานที่: %s\nรายละเอียด: %s\n\nหากยังพบรถหลังครบกำหนด อาจมีการหักคะแนนตามระเบียบของมหาวิทยาลัย',
          v_report.plate_number, coalesce(v_report.location, '-'), v_report.description), 'QUEUED');
      v_result := 'ส่งคำเตือนให้เคลื่อนรถภายใน 30 นาทีแล้ว';
    else
      v_result := 'เริ่มนับเวลา 30 นาทีแล้ว แต่ยังไม่พบอีเมลเจ้าของรถ';
    end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'REPORT_WARNING_SENT', 'report', p_report_id,
      jsonb_build_object('warning_deadline', now() + interval '30 minutes', 'recipient_email', v_owner_email));
    return jsonb_build_object('result', v_result, 'report_id', p_report_id,
      'status', 'UNDER_REVIEW', 'enforcement_status', 'WARNING_SENT',
      'warning_deadline', now() + interval '30 minutes');
  end if;

  -- Final step: Admin must re-check after the deadline before deducting points.
  if p_status = 'APPROVED' then
    if v_action <> 'PENALTY' then raise exception 'เลือกหัก 5 คะแนนหลังครบเวลา 30 นาที'; end if;
    if v_report.warning_sent_at is null then raise exception 'ต้องส่งคำเตือน 30 นาทีก่อน'; end if;
    if v_report.warning_deadline > now() then
      raise exception 'ยังไม่ครบเวลา 30 นาที กรุณารอให้ครบกำหนดก่อน';
    end if;
    select * into v_rule from public.penalty_rules
    where violation_type = coalesce(v_report.violation_type, '') and active = true limit 1;
    if not exists (select 1 from public.penalties where report_id = p_report_id) then
      insert into public.penalties(vehicle_id, report_id, rule_id, points, fine_amount, reason)
      values (v_vehicle.id, p_report_id, v_rule.id, 5, coalesce(v_rule.fine_amount, 0),
        coalesce(nullif(p_note, ''), 'ไม่เคลื่อนรถภายใน 30 นาทีหลังได้รับคำเตือน'));
    end if;
    update public.reports
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
        penalty_applied_at = coalesce(penalty_applied_at, now()), enforcement_status = 'PENALTY_APPLIED'
    where id = p_report_id;
    v_status_label := 'ตรวจสอบแล้ว · หัก 5 คะแนน';
    if v_reporter_email is not null then
      insert into public.notification_queue(report_id, recipient_email, subject, body, status)
      values (p_report_id, v_reporter_email, 'ผลการตรวจสอบรายงาน KKU ParkFlow',
        format(E'เรียนคุณ %s\n\nรายงานได้รับการดำเนินการแล้ว\nสถานะ: %s\nหักคะแนน: 5 คะแนน\nรายละเอียด: %s',
          coalesce(nullif(v_reporter_name, ''), 'ผู้รายงาน'), v_status_label, v_report.description), 'QUEUED');
    end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'PENALTY_APPLIED', 'report', p_report_id,
      jsonb_build_object('points_deducted', 5, 'fine_amount', coalesce(v_rule.fine_amount, 0), 'note', coalesce(p_note, '')));
    return jsonb_build_object('result', 'ครบ 30 นาทีและหัก 5 คะแนนแล้ว', 'report_id', p_report_id,
      'status', 'APPROVED', 'enforcement_status', 'PENALTY_APPLIED');
  end if;

  if p_status = 'REJECTED' then
    update public.reports set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(),
      enforcement_status = 'CLOSED_NO_PENALTY' where id = p_report_id;
    v_result := 'ไม่เข้าเกณฑ์ — ไม่มีบทลงโทษ';
  elsif p_status = 'REQUEST_INFO' then
    update public.reports set status = 'REQUEST_INFO', reviewed_by = auth.uid(), reviewed_at = now(),
      enforcement_status = 'INFO_REQUESTED' where id = p_report_id;
    v_result := 'ส่งคำขอข้อมูลเพิ่มเติมแล้ว';
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'REPORT_DECISION', 'report', p_report_id,
    jsonb_build_object('status', p_status, 'action', v_action, 'note', coalesce(p_note, ''), 'points_deducted', 0));
  return jsonb_build_object('result', v_result, 'report_id', p_report_id, 'status', p_status);
end;
$$;

grant execute on function public.decide_report(uuid, text, text, text) to authenticated;

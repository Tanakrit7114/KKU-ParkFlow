-- Automatically remove reports and their dependent records after two years.
-- The check runs daily; a report is eligible based on created_at.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.purge_expired_reports()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  deleted_count integer := 0;
begin
  create temp table if not exists expired_report_ids (
    id uuid primary key
  ) on commit drop;
  truncate expired_report_ids;

  insert into expired_report_ids (id)
  select id
  from public.reports
  where created_at < now() - interval '2 years';

  -- Remove evidence metadata before deleting the report rows. The Storage
  -- bucket remains available for new uploads.
  delete from storage.objects
  where bucket_id = 'evidence'
    and name in (
      select evidence_path
      from public.reports
      where id in (select id from expired_report_ids)
        and evidence_path is not null
    );

  delete from public.notification_queue
  where report_id in (select id from expired_report_ids);

  delete from public.appeals
  where report_id in (select id from expired_report_ids);

  delete from public.penalties
  where report_id in (select id from expired_report_ids);

  delete from public.audit_logs
  where entity_type = 'report'
    and entity_id in (select id from expired_report_ids);

  delete from public.reports
  where id in (select id from expired_report_ids);
  get diagnostics deleted_count = row_count;

  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_reports() from public;
grant execute on function public.purge_expired_reports() to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'kku-parkflow-purge-expired-reports'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'kku-parkflow-purge-expired-reports',
    '0 18 * * *',
    'select public.purge_expired_reports();'
  );
end;
$$;

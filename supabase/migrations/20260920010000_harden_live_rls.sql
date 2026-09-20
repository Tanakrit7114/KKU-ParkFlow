-- Bring the production RLS policies in line with the Supabase schema.
-- This migration is intentionally idempotent so it can be re-run safely.

alter table if exists public.profiles enable row level security;
alter table if exists public.reports enable row level security;
alter table if exists public.vehicle_registry enable row level security;
alter table if exists public.penalty_rules enable row level security;
alter table if exists public.penalties enable row level security;
alter table if exists public.appeals enable row level security;
alter table if exists public.audit_logs enable row level security;
alter table if exists public.notification_queue enable row level security;
alter table if exists public.mock_gmail_contacts enable row level security;
alter table if exists public.mock_gmail_messages enable row level security;

drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "admins read reporter profiles" on public.profiles;
create policy "admins read reporter profiles"
  on public.profiles for select
  using (public.is_admin());

drop policy if exists "users create own profile" on public.profiles;
create policy "users create own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "users read own reports" on public.reports;
create policy "users read own reports"
  on public.reports for select
  using (auth.uid() = reporter_id);

drop policy if exists "users create own reports" on public.reports;
create policy "users create own reports"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

drop policy if exists "admins read all reports" on public.reports;
create policy "admins read all reports"
  on public.reports for select
  using (public.is_admin());

drop policy if exists "admins update reports" on public.reports;
create policy "admins update reports"
  on public.reports for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins manage vehicle registry" on public.vehicle_registry;
create policy "admins manage vehicle registry"
  on public.vehicle_registry for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins manage penalty rules" on public.penalty_rules;
create policy "admins manage penalty rules"
  on public.penalty_rules for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins manage penalties" on public.penalties;
create policy "admins manage penalties"
  on public.penalties for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "users read own penalties" on public.penalties;
create policy "users read own penalties"
  on public.penalties for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.vehicle_registry v
      where v.id = vehicle_id
        and v.owner_user_id = auth.uid()
    )
  );

drop policy if exists "users create own appeals" on public.appeals;
create policy "users create own appeals"
  on public.appeals for insert
  to authenticated
  with check (auth.uid() = appellant_id);

drop policy if exists "users read own appeals" on public.appeals;
create policy "users read own appeals"
  on public.appeals for select
  to authenticated
  using (auth.uid() = appellant_id or public.is_admin());

drop policy if exists "admins manage appeals" on public.appeals;
create policy "admins manage appeals"
  on public.appeals for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins read audit logs" on public.audit_logs;
create policy "admins read audit logs"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins create audit logs" on public.audit_logs;
create policy "admins create audit logs"
  on public.audit_logs for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins manage notification queue" on public.notification_queue;
create policy "admins manage notification queue"
  on public.notification_queue for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins manage mock gmail contacts" on public.mock_gmail_contacts;
create policy "admins manage mock gmail contacts"
  on public.mock_gmail_contacts for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins manage mock gmail messages" on public.mock_gmail_messages;
create policy "admins manage mock gmail messages"
  on public.mock_gmail_messages for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

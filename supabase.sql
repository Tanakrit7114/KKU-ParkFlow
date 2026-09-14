create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text not null, name text, role text not null default 'student' check (role in ('student','staff','admin','super_admin')), created_at timestamptz default now());
create table if not exists public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid not null references public.profiles(id), plate_number text, description text not null, incident_datetime timestamptz not null, evidence_path text, status text not null default 'PENDING' check (status in ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','REQUEST_INFO')), ai_confidence numeric, ai_flags jsonb default '[]', reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz default now());
alter table public.profiles enable row level security; alter table public.reports enable row level security;
create policy "users read own profile" on public.profiles for select using (auth.uid()=id);
create policy "users read own reports" on public.reports for select using (auth.uid()=reporter_id);
create policy "users create own reports" on public.reports for insert with check (auth.uid()=reporter_id);
insert into storage.buckets(id,name,public) values('evidence','evidence',false) on conflict(id) do nothing;
create policy "users upload own evidence" on storage.objects for insert to authenticated with check (bucket_id='evidence' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users read own evidence" on storage.objects for select to authenticated using (bucket_id='evidence' and (storage.foldername(name))[1]=auth.uid()::text);

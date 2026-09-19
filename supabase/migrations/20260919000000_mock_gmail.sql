create table if not exists public.mock_gmail_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index if not exists mock_gmail_contacts_email_idx
  on public.mock_gmail_contacts (lower(email));

create table if not exists public.mock_gmail_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete set null,
  recipient_email text not null,
  recipient_name text,
  subject text not null,
  body text not null,
  status text not null default 'SENT' check (status in ('DRAFT','SENT','FAILED')),
  sent_by uuid references public.profiles(id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mock_gmail_messages_sent_at_idx
  on public.mock_gmail_messages (sent_at desc);

alter table public.mock_gmail_contacts enable row level security;
alter table public.mock_gmail_messages enable row level security;

drop policy if exists "admins manage mock gmail contacts" on public.mock_gmail_contacts;
create policy "admins manage mock gmail contacts"
  on public.mock_gmail_contacts for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins manage mock gmail messages" on public.mock_gmail_messages;
create policy "admins manage mock gmail messages"
  on public.mock_gmail_messages for all
  using (public.is_admin()) with check (public.is_admin());

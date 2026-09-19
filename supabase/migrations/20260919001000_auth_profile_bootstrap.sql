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

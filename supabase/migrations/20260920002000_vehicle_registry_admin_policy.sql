alter table public.vehicle_registry enable row level security;

drop policy if exists "admins manage vehicle registry" on public.vehicle_registry;
create policy "admins manage vehicle registry"
  on public.vehicle_registry for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

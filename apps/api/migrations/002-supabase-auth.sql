-- Run once in this project's Supabase SQL editor before enabling real login.
-- Authentication credentials stay exclusively in auth.users / auth.identities.
begin;
create table if not exists public.app_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  requested_company text not null default '',
  company_id text,
  role text check (role in ('admin','staff','worker','customer')),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','inactive')),
  active boolean not null default false,
  locked boolean not null default false,
  worker_id text,
  site_ids text[] not null default '{}',
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approval_status <> 'approved' or (company_id is not null and role is not null)),
  check (role <> 'worker' or approval_status <> 'approved' or worker_id is not null),
  check (permissions <@ array['internalCosts','siteFinance','workerPayments','editSchedule','writeQuotes','manageMaterials','approveMaterials']::text[]),
  check (role in ('admin','staff') or cardinality(permissions) = 0)
);
alter table public.app_memberships enable row level security;
revoke all on public.app_memberships from anon, authenticated;
grant select, insert, update on public.app_memberships to authenticated;

-- SECURITY DEFINER avoids recursive membership policies. No user-supplied SQL or search_path.
create or replace function public.app_is_company_admin(target_company text)
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.app_memberships m where m.user_id = auth.uid()
   and m.company_id = target_company and m.role = 'admin'
   and m.approval_status = 'approved' and m.active and not m.locked);
$$;
create or replace function public.app_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.app_memberships m where m.user_id = auth.uid()
   and m.company_id is not null and m.role = 'admin'
   and m.approval_status = 'approved' and m.active and not m.locked);
$$;
revoke all on function public.app_is_company_admin(text), public.app_is_admin() from public, anon;
grant execute on function public.app_is_company_admin(text), public.app_is_admin() to authenticated;

drop policy if exists membership_read on public.app_memberships;
create policy membership_read on public.app_memberships for select to authenticated
using (user_id = auth.uid() or public.app_is_company_admin(company_id) or (company_id is null and public.app_is_admin()));
drop policy if exists membership_request on public.app_memberships;
create policy membership_request on public.app_memberships for insert to authenticated
with check (user_id = auth.uid() and company_id is null and role is null
 and approval_status = 'pending' and not active and not locked and worker_id is null
 and cardinality(site_ids) = 0 and cardinality(permissions) = 0
 and email = coalesce(auth.jwt()->>'email', ''));
drop policy if exists membership_approve on public.app_memberships;
create policy membership_approve on public.app_memberships for update to authenticated
using (public.app_is_company_admin(company_id) or (company_id is null and public.app_is_admin()))
with check (public.app_is_company_admin(company_id));

create or replace function public.app_guard_membership_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.user_id <> old.user_id or new.email <> old.email or new.created_at <> old.created_at then
   raise exception 'Authentication identity is immutable';
 end if;
 if old.role = 'admin' and old.approval_status = 'approved' and old.active and not old.locked
    and (new.company_id is distinct from old.company_id or new.role <> 'admin'
         or new.approval_status <> 'approved' or not new.active or new.locked) then
   perform pg_advisory_xact_lock(hashtextextended(old.company_id, 0));
   if not exists(select 1 from public.app_memberships m where m.user_id <> old.user_id
       and m.company_id = old.company_id and m.role = 'admin'
       and m.approval_status = 'approved' and m.active and not m.locked) then
     raise exception 'At least one active administrator is required';
   end if;
 end if;
 new.updated_at = now();
 return new;
end;
$$;
revoke all on function public.app_guard_membership_update() from public, anon, authenticated;
drop trigger if exists guard_membership_update on public.app_memberships;
create trigger guard_membership_update before update on public.app_memberships
for each row execute function public.app_guard_membership_update();
commit;

-- Bootstrap is an operator-only SQL editor step after the intended admin signs in once.
-- Replace the UUID and company_id after verifying the user's Auth identity.
-- Never match by user_metadata.role, arbitrary email, or a client-submitted company.
-- update public.app_memberships set company_id = '<existing-app-company-id>', role = 'admin',
--   approval_status = 'approved', active = true where user_id = '<verified-supabase-user-uuid>';

-- Operator-run only after 002; preserves existing rows, roles and the first administrator.
begin;
alter table public.app_memberships add column if not exists phone text not null default '';
alter table public.app_memberships add column if not exists requested_role text;
alter table public.app_memberships add column if not exists registered_at timestamptz;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.app_memberships'::regclass and conname='membership_requested_role_check') then
    alter table public.app_memberships add constraint membership_requested_role_check
      check (requested_role is null or requested_role in ('staff','worker','customer'));
  end if;
end $$;

-- Populate descriptive fields only. User metadata never assigns company, role or approval.
create or replace function public.app_capture_membership_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare u auth.users%rowtype;
begin
  select * into u from auth.users where id=new.user_id;
  if found then
    new.phone=left(btrim(coalesce(u.raw_user_meta_data->>'phone','')),40);
    new.requested_role=case when u.raw_user_meta_data->>'requested_role' in ('staff','worker','customer')
      then u.raw_user_meta_data->>'requested_role' else null end;
    new.registered_at=u.created_at;
  end if;
  return new;
end $$;
revoke all on function public.app_capture_membership_profile() from public,anon,authenticated;
drop trigger if exists capture_membership_profile on public.app_memberships;
create trigger capture_membership_profile before insert on public.app_memberships
for each row execute function public.app_capture_membership_profile();

create or replace function public.app_capture_signup_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_memberships(user_id,email,display_name,requested_company)
  values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',''),200),left(coalesce(new.raw_user_meta_data->>'requested_company',''),200))
  on conflict(user_id) do nothing;
  return new;
end $$;
revoke all on function public.app_capture_signup_membership() from public,anon,authenticated;
drop trigger if exists capture_signup_membership on auth.users;
create trigger capture_signup_membership after insert on auth.users
for each row execute function public.app_capture_signup_membership();

-- Recover previously saved signup metadata without replacing existing membership values.
update public.app_memberships m set
  phone=case when m.phone='' then left(btrim(coalesce(u.raw_user_meta_data->>'phone','')),40) else m.phone end,
  requested_role=coalesce(m.requested_role,case when u.raw_user_meta_data->>'requested_role' in ('staff','worker','customer') then u.raw_user_meta_data->>'requested_role' else null end),
  registered_at=coalesce(m.registered_at,u.created_at)
from auth.users u where u.id=m.user_id
and (m.registered_at is null or (m.phone='' and coalesce(u.raw_user_meta_data->>'phone','')<>'') or (m.requested_role is null and u.raw_user_meta_data->>'requested_role' in ('staff','worker','customer')));

-- Add missing records only; preserve every existing approval decision.
insert into public.app_memberships(user_id,email,display_name,requested_company)
select u.id,coalesce(u.email,''),left(coalesce(u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name',''),200),left(coalesce(u.raw_user_meta_data->>'requested_company',''),200)
from auth.users u on conflict(user_id) do nothing;
commit;

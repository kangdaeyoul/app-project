-- Operator-run ONLY after 002–006. No operational connection settings or existing rows are reset.
begin;
alter table app_core.companies add column if not exists slug text;
alter table app_core.companies add column if not exists active boolean not null default true;
update app_core.companies set slug=case when company_id='jongro' then 'jongro' else 'company-'||substr(md5(company_id),1,16) end where slug is null;
alter table app_core.companies alter column slug set not null;
create unique index if not exists core_company_slug on app_core.companies(slug);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='core_company_slug_format' and conrelid='app_core.companies'::regclass) then
 alter table app_core.companies add constraint core_company_slug_format check(slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'); end if;
end $$;
-- Existing deployments may still register companies by company_id. Supply a safe unique default.
create or replace function app_core.default_company_slug() returns trigger language plpgsql set search_path='' as $$
begin if new.slug is null then new.slug='company-'||substr(md5(new.company_id),1,16); end if; return new; end $$;
revoke all on function app_core.default_company_slug() from public,anon,authenticated;
drop trigger if exists core_default_slug on app_core.companies;
create trigger core_default_slug before insert on app_core.companies for each row execute function app_core.default_company_slug();

alter table public.app_memberships add column if not exists id uuid not null default gen_random_uuid();
alter table public.app_memberships add column if not exists approved_at timestamptz;
alter table public.app_memberships add column if not exists approved_by uuid references auth.users(id) on delete set null;
do $$ begin
 if exists(select 1 from pg_constraint where conrelid='public.app_memberships'::regclass and contype='p' and conname='app_memberships_pkey' and pg_get_constraintdef(oid)='PRIMARY KEY (user_id)') then
 alter table public.app_memberships drop constraint app_memberships_pkey;
 alter table public.app_memberships add primary key(id);
 end if;
 if not exists(select 1 from pg_constraint where conname='core_membership_company_fk' and conrelid='public.app_memberships'::regclass) then
 alter table public.app_memberships add constraint core_membership_company_fk foreign key(company_id) references app_core.companies(company_id) on delete restrict not valid;
 end if;
end $$;
create unique index if not exists core_membership_company_user on public.app_memberships(company_id,user_id);
create unique index if not exists core_membership_unassigned_user on public.app_memberships(user_id) where company_id is null;

create table if not exists app_core.company_invites (
 id uuid primary key default gen_random_uuid(), company_id text not null references app_core.companies(company_id) on delete restrict,
 token_hash text not null unique, role text not null check(role in ('staff','worker')),
 expires_at timestamptz not null, is_active boolean not null default true,
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists core_invite_company on app_core.company_invites(company_id,created_at);
create table if not exists app_core.onboarding_intents (
 token_hash text primary key, kind text not null check(kind in ('company','invite')), email text not null,
 company_id text, slug text, payload jsonb not null default '{}',
 invite_id uuid references app_core.company_invites(id) on delete restrict,
 expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now(),
 check((kind='company' and company_id is not null and slug is not null) or (kind='invite' and invite_id is not null))
);
alter table app_core.company_invites enable row level security;
alter table app_core.onboarding_intents enable row level security;
revoke all on app_core.company_invites,app_core.onboarding_intents from public,anon,authenticated;
grant select on app_core.company_invites to authenticated;
drop policy if exists core_invite_admin on app_core.company_invites;
create policy core_invite_admin on app_core.company_invites for select to authenticated using(public.app_is_company_admin(company_id));

-- Tokens originate exclusively at the trusted API, are email-bound, hashed at rest, and consumed atomically.
create or replace function public.app_capture_signup_membership() returns trigger
language plpgsql security definer set search_path='' as $$
declare intent app_core.onboarding_intents%rowtype; invitation app_core.company_invites%rowtype;
begin
 select * into intent from app_core.onboarding_intents
 where token_hash=encode(sha256(convert_to(coalesce(new.raw_user_meta_data->>'onboarding_token',''),'UTF8')),'hex')
 and email=lower(new.email) and consumed_at is null and expires_at>now() for update;
 if found then
   if intent.kind='company' then
     insert into app_core.companies(company_id,slug,payload) values(intent.company_id,intent.slug,intent.payload);
     insert into public.app_memberships(user_id,email,display_name,company_id,role,approval_status,active,approved_at,approved_by)
     values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'display_name',''),200),intent.company_id,'admin','approved',true,now(),new.id);
   else
     select i.* into invitation from app_core.company_invites i join app_core.companies c using(company_id)
     where i.id=intent.invite_id and i.is_active and i.expires_at>now() and c.active for update of i;
     if not found then raise exception 'Invitation is no longer valid'; end if;
     insert into public.app_memberships(user_id,email,display_name,requested_company,company_id,requested_role)
     values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'display_name',''),200),
       (select coalesce(payload->>'name',company_id) from app_core.companies where company_id=invitation.company_id),invitation.company_id,invitation.role);
   end if;
   update app_core.onboarding_intents set consumed_at=now() where token_hash=intent.token_hash;
 else
   if coalesce(new.raw_user_meta_data->>'onboarding_token','')<>'' then raise exception 'Invalid or expired onboarding request'; end if;
   -- Legacy/OAuth signups remain unassigned and gain no company access. No metadata role is trusted.
   insert into public.app_memberships(user_id,email,display_name,requested_company)
   values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',''),200),left(coalesce(new.raw_user_meta_data->>'requested_company',''),200)) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.app_capture_signup_membership() from public,anon,authenticated;
-- 005's profile trigger previously overwrote requested_role; invite-derived role must remain authoritative.
create or replace function public.app_capture_membership_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare u auth.users%rowtype;
begin
 select * into u from auth.users where id=new.user_id;
 if found then
   new.phone=left(btrim(coalesce(u.raw_user_meta_data->>'phone','')),40);
   if new.company_id is null then new.requested_role=case when u.raw_user_meta_data->>'requested_role' in ('staff','worker','customer') then u.raw_user_meta_data->>'requested_role' else null end; end if;
   new.registered_at=u.created_at;
 end if;
 return new;
end $$;

-- No administrator may inspect or claim another company's or an unassigned signup request.
drop policy if exists membership_read on public.app_memberships;
create policy membership_read on public.app_memberships for select to authenticated
 using(user_id=auth.uid() or public.app_is_company_admin(company_id));
drop policy if exists membership_approve on public.app_memberships;
create policy membership_approve on public.app_memberships for update to authenticated
 using(public.app_is_company_admin(company_id)) with check(public.app_is_company_admin(company_id));
create or replace function public.app_guard_membership_update() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.id<>old.id or new.user_id<>old.user_id or new.email<>old.email or new.created_at<>old.created_at then raise exception 'Authentication identity is immutable'; end if;
 if new.company_id is distinct from old.company_id and old.company_id is not null then raise exception 'Company ownership is immutable'; end if;
 if old.role='admin' and old.approval_status='approved' and old.active and not old.locked
 and (new.company_id is distinct from old.company_id or new.role is distinct from 'admin' or new.approval_status<>'approved' or not new.active or new.locked) then
 perform pg_advisory_xact_lock(hashtextextended(old.company_id,0));
 if not exists(select 1 from public.app_memberships m where m.user_id<>old.user_id and m.company_id=old.company_id and m.role='admin' and m.approval_status='approved' and m.active and not m.locked) then raise exception 'At least one active administrator is required'; end if;
 end if;
 new.updated_at=now(); return new;
end $$;
-- Assigned membership ownership is immutable even for server-side operations.
create or replace function public.app_membership_providers()
returns table(user_id uuid,providers text[],registered_at timestamptz)
language sql stable security definer set search_path='' as $$
 select m.user_id,coalesce(array_agg(distinct i.provider::text) filter(where i.provider is not null),'{}'::text[]),u.created_at
 from public.app_memberships m join auth.users u on u.id=m.user_id left join auth.identities i on i.user_id=m.user_id
 where public.app_is_company_admin(m.company_id) group by m.user_id,u.created_at;
$$;
-- Existing helper names remain compatible; inactive companies grant no business access.
create or replace function public.app_is_company_admin(target_company text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_memberships m join app_core.companies c using(company_id)
 where m.user_id=auth.uid() and m.company_id=target_company and c.active and m.role='admin'
 and m.approval_status='approved' and m.active and not m.locked);
$$;
create or replace function public.app_is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_memberships m join app_core.companies c using(company_id)
 where m.user_id=auth.uid() and c.active and m.role='admin' and m.approval_status='approved' and m.active and not m.locked);
$$;
create or replace function app_core.is_staff(target_company text,required_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_memberships m join app_core.companies c using(company_id)
 where m.user_id=auth.uid() and m.company_id=target_company and c.active and m.role='staff'
 and m.approval_status='approved' and m.active and not m.locked and required_permission=any(m.permissions));
$$;
drop policy if exists core_worker_availability on app_core.worker_availability;
create policy core_worker_availability on app_core.worker_availability for select to authenticated using(
 exists(select 1 from public.app_memberships m join app_core.companies c using(company_id)
 where m.user_id=auth.uid() and m.company_id=worker_availability.company_id and c.active
 and m.worker_id=worker_availability.worker_id and m.role='worker' and m.approval_status='approved' and m.active and not m.locked));
commit;

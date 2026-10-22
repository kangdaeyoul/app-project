-- Operator-run ONLY in Supabase SQL Editor after 002–005. Never executed at app startup.
-- New private schema avoids collisions with legacy/material tables. No existing rows are deleted.
begin;
create schema if not exists app_core;
revoke all on schema app_core from public, anon;
grant usage on schema app_core to authenticated;
create table if not exists app_core.companies (
 company_id text primary key check (company_id <> '' and company_id !~ '^trial_'),
 payload jsonb not null default '{}' check (jsonb_typeof(payload)='object'),
 auxiliary jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Register only existing membership company IDs; no membership/auth row is altered.
-- Company profile is configured by its administrator; no tenant inherits another tenant's profile.
insert into app_core.companies(company_id)
 select distinct company_id from public.app_memberships where company_id is not null and company_id <> '' and company_id !~ '^trial_'
 on conflict do nothing;
create table if not exists app_core.customers (
 company_id text not null references app_core.companies(company_id) on delete restrict,
 id text not null, payload jsonb not null check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(company_id,id)
);
create table if not exists app_core.workers (
 company_id text not null references app_core.companies(company_id) on delete restrict,
 id text not null, payload jsonb not null check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(company_id,id)
);
create table if not exists app_core.sites (
 company_id text not null references app_core.companies(company_id) on delete restrict,
 id text not null, customer_id text, manager_id text, payload jsonb not null check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(company_id,id),
 foreign key(company_id,customer_id) references app_core.customers(company_id,id) on delete restrict,
 foreign key(company_id,manager_id) references app_core.workers(company_id,id) on delete restrict
);
create table if not exists app_core.daily_work (
 company_id text not null references app_core.companies(company_id) on delete restrict,
 id text not null, site_id text not null, manager_id text, payload jsonb not null check(jsonb_typeof(payload)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(company_id,id),
 foreign key(company_id,site_id) references app_core.sites(company_id,id) on delete restrict,
 foreign key(company_id,manager_id) references app_core.workers(company_id,id) on delete restrict
);
create table if not exists app_core.worker_availability (
 company_id text not null, worker_id text not null, payload jsonb not null check(jsonb_typeof(payload)='array'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(company_id,worker_id),
 foreign key(company_id,worker_id) references app_core.workers(company_id,id) on delete restrict
);
create table if not exists app_core.daily_work_participants (
 company_id text not null, daily_work_id text not null, worker_id text not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'), deleted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(company_id,daily_work_id,worker_id),
 foreign key(company_id,daily_work_id) references app_core.daily_work(company_id,id) on delete restrict,
 foreign key(company_id,worker_id) references app_core.workers(company_id,id) on delete restrict
);
create index if not exists core_sites_customer on app_core.sites(company_id,customer_id);
create index if not exists core_sites_manager on app_core.sites(company_id,manager_id);
create index if not exists core_daily_site on app_core.daily_work(company_id,site_id);
create index if not exists core_daily_manager on app_core.daily_work(company_id,manager_id);
create index if not exists core_daily_date on app_core.daily_work(company_id,(payload->>'workDate'));
create index if not exists core_participant_worker on app_core.daily_work_participants(company_id,worker_id) where deleted_at is null;
create index if not exists core_membership_company on public.app_memberships(company_id,user_id) where approval_status='approved' and active and not locked;

-- Keep timestamps correct for both API and operator/client updates; ownership is immutable.
create or replace function app_core.guard_row()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if new.company_id is distinct from old.company_id then raise exception 'Company ownership is immutable'; end if;
   new.created_at=old.created_at;
 end if;
 if new.payload ? 'companyId' and new.payload->>'companyId' is distinct from new.company_id then
   raise exception 'Payload company mismatch';
 end if;
 if to_jsonb(new) ? 'id' and new.payload ? 'id' and new.payload->>'id' is distinct from to_jsonb(new)->>'id' then
   raise exception 'Payload ID mismatch';
 end if;
 if tg_table_name='companies' and new.payload ? 'id' and new.payload->>'id' is distinct from new.company_id then
   raise exception 'Company profile ID mismatch';
 end if;
 new.updated_at=now();
 return new;
end $$;
revoke all on function app_core.guard_row() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['companies','customers','workers','sites','daily_work','worker_availability','daily_work_participants'] loop
   execute format('drop trigger if exists core_guard_row on app_core.%I',t);
   execute format('create trigger core_guard_row before insert or update on app_core.%I for each row execute function app_core.guard_row()',t);
 end loop;
end $$;

-- Database access is an additional boundary. API remains responsible for field projection.
-- In particular sites/company auxiliary payloads contain finance: no direct staff/worker SELECT.
create or replace function app_core.is_staff(target_company text, required_permission text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_memberships m where m.user_id=auth.uid() and m.company_id=target_company
 and m.approval_status='approved' and m.active and not m.locked and m.role='staff'
 and required_permission=any(m.permissions));
$$;
revoke all on function app_core.is_staff(text,text) from public,anon;
grant execute on function app_core.is_staff(text,text) to authenticated;

do $$ declare t text; begin
 foreach t in array array['companies','customers','workers','sites','daily_work','worker_availability','daily_work_participants'] loop
   execute format('alter table app_core.%I enable row level security',t);
   execute format('revoke all on app_core.%I from public,anon,authenticated',t);
   execute format('grant select,insert,update on app_core.%I to authenticated',t);
   execute format('drop policy if exists core_admin_read on app_core.%I',t);
   execute format('create policy core_admin_read on app_core.%I for select to authenticated using(public.app_is_company_admin(company_id))',t);
   -- Provision companies through operator SQL, never an unapproved client request.
   if t <> 'companies' then
     execute format('drop policy if exists core_admin_insert on app_core.%I',t);
     execute format('create policy core_admin_insert on app_core.%I for insert to authenticated with check(public.app_is_company_admin(company_id))',t);
   end if;
   execute format('drop policy if exists core_admin_update on app_core.%I',t);
   execute format('create policy core_admin_update on app_core.%I for update to authenticated using(public.app_is_company_admin(company_id)) with check(public.app_is_company_admin(company_id))',t);
 end loop;
end $$;
drop policy if exists core_staff_customers on app_core.customers;
create policy core_staff_customers on app_core.customers for select to authenticated
 using(app_core.is_staff(company_id,'writeQuotes'));
-- Workers may directly read only their own availability; operational work is served by
-- the authenticated API's assignment checks and financial-field whitelist, never raw site JSON.
drop policy if exists core_worker_availability on app_core.worker_availability;
create policy core_worker_availability on app_core.worker_availability for select to authenticated using (
 exists(select 1 from public.app_memberships m where m.user_id=auth.uid() and m.company_id=worker_availability.company_id
 and m.worker_id=worker_availability.worker_id and m.role='worker' and m.approval_status='approved' and m.active and not m.locked)
);
-- Deliberately no DELETE grants/policies, and no cascading business deletion.
commit;
-- Future company provisioning (operator only, after verifying intended company ID):
-- insert into app_core.companies(company_id,payload) values ('<verified-company-id>','{"name":"회사명","displayName":"회사명"}'::jsonb);
-- No automatic import of process memory. Export and review old live data BEFORE enabling postgres.

-- Operator-run only, after 002-supabase-auth.sql. Never run automatically.
-- Trials are server-owned ephemeral tenants, never Supabase memberships.
begin;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_memberships'::regclass
      and conname = 'app_memberships_no_trial_company'
  ) then
    alter table public.app_memberships
      add constraint app_memberships_no_trial_company
      check (company_id is null or company_id !~ '^trial_');
  end if;
end;
$$;
commit;

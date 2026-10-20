-- Operator-run in Supabase SQL Editor after 002. No secret/service-role key required.
-- Read-only access to verified Auth identities, limited to each administrator's scope.
begin;
create or replace function public.app_membership_providers()
returns table(user_id uuid, providers text[], registered_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id,
    coalesce(array_agg(distinct i.provider::text)
      filter (where i.provider is not null), '{}'::text[]), u.created_at
  from public.app_memberships m
  join auth.users u on u.id = m.user_id
  left join auth.identities i on i.user_id = m.user_id
  where public.app_is_admin()
    and (m.company_id is null or public.app_is_company_admin(m.company_id))
  group by m.user_id, u.created_at;
$$;
revoke all on function public.app_membership_providers() from public, anon;
grant execute on function public.app_membership_providers() to authenticated;
commit;

# Supabase Auth 연결과 기존 Render 서비스 설정

## 현재 작업 상태와 직접 실행 순서

승인 테이블 SQL은 아직 실제 Supabase에서 실행하지 않았습니다. 실제 Supabase·Google 연결 검증은 보류 중이며, 환경변수 저장/게시 문제는 별도로 해결합니다. 아래 SQL은 **사용자가 Supabase Dashboard의 SQL Editor에서 직접 실행**하는 절차입니다. 이 문서 정리 과정에서 SQL 실행·환경변수 변경·배포를 하지 않습니다.

| 순서 | 작업 | 지금 실행 여부 |
| --- | --- | --- |
| 1 | 대상 프로젝트와 기존 승인 테이블 유무 확인 | SQL Editor에서 직접 확인 가능 |
| 2 | 아래 전체 승인 테이블/RLS SQL 실행 | 사용자가 직접 실행 |
| 3 | 생성된 테이블·RLS·정책·트리거 확인 | 2단계 성공 후 직접 실행 |
| 4 | 런타임 환경변수 주입·앱 연결 준비 | 별도 문제 해결 후 진행 |
| 5 | 첫 실제 관리자 로그인 → 승인대기 레코드 확인 | 실제 연결 검증 재개 시 진행 |
| 6 | UUID를 확인하고 첫 관리자 한 명 승인 | 5단계 확인 후 직접 실행 |
| 7 | 앱에서 승인 확인·후속 사용자 회사/역할 배정 | 실제 연결 검증 재개 시 진행 |

**테이블 생성과 첫 관리자 승인은 별도 작업입니다.** 환경변수 문제가 해결되기 전에는 1~3단계만 준비할 수 있습니다. 테이블을 만든 것만으로 관리자나 로그인 세션이 생성되지는 않습니다. URL/공개 key를 SQL에 넣을 필요가 없으며 secret/service-role key도 필요하지 않습니다.

## 인증과 회사 권한은 별개입니다

실제 이메일/비밀번호·Google 로그인은 Supabase Auth가 처리합니다. API는 Supabase `/auth/v1/user`로 사용자를 검증하며 브라우저가 보낸 역할, 회사 ID, user_metadata.role 또는 단순 JWT 디코딩 결과를 권한으로 신뢰하지 않습니다.

회원의 키는 `auth.users.id` UUID입니다. 이메일과 Google을 연결해도 같은 Supabase UUID이면 같은 승인 레코드를 사용합니다. 앱이 이메일 문자열만 보고 임의로 계정을 합치지 않습니다. 인증된 상태의 **Google 계정 연결**은 Supabase `linkIdentity`를 사용합니다. Supabase 설정의 수동 계정 연결(Enable manual linking)을 활성화해야 할 수 있습니다. 자동 연결은 Supabase의 검증된 이메일/identity 정책을 따릅니다.

승인 정보는 `public.app_memberships`에 영구 저장합니다. 최초 로그인 때 회사·역할 없이 `pending`, `active=false`로 생성합니다. `user_metadata`의 회사·역할은 승인에 사용하지 않습니다. 회사와 역할을 지정하고 `approved`·활성으로 승인하기 전에는 현장·견적·사진 등 업무 API에 접근할 수 없습니다. 승인 변경·잠금은 다음 요청부터 확인합니다.

## 1. 승인 테이블 생성: SQL Editor에서 직접 실행

### 1-1. 대상 프로젝트와 기존 테이블 확인

1. Supabase Dashboard에서 앱에 연결할 프로젝트를 선택합니다. 프로젝트 URL이 등록한 `SUPABASE_URL`의 프로젝트와 같은지 확인합니다.
2. **SQL Editor → New query**를 열고 아래 조회만 먼저 실행합니다. Supabase 기본 `postgres` 실행 역할을 사용합니다. 앱의 `anon`/`authenticated` 역할로 설치하지 않습니다.

```sql
select
  to_regclass('auth.users') as auth_users,
  to_regclass('public.app_memberships') as approval_table;
```

- `auth_users`는 `auth.users`여야 합니다.
- `approval_table`이 `null`이면 아직 승인 테이블이 없으므로 다음 단계로 진행합니다.
- 이미 `app_memberships`가 있다면 기존 구조·정책을 먼저 확인합니다. 아래 SQL의 `CREATE TABLE IF NOT EXISTS`는 기존 열을 새 구조로 변환하지 않습니다. 기존 테이블을 삭제하거나 재생성하지 마세요. 같은 버전을 재적용하면 승인 행은 보존되지만 아래 이름의 정책·함수·트리거 정의는 갱신됩니다.

### 1-2. 전체 설치 SQL 실행

새 쿼리에 아래 블록 **전체를 한 번에 복사**해 Run을 누릅니다. 파일 원본은 [002-supabase-auth.sql](../apps/api/migrations/002-supabase-auth.sql)이며 아래 내용과 동일합니다. `BEGIN`부터 `COMMIT`까지가 설치이고, 마지막 관리자 지정 예제는 주석이므로 실행되지 않습니다.

생성 대상은 승인 테이블 1개, 관리자 검사 함수 2개, RLS 정책 3개, 변경 보호 함수와 트리거 각 1개입니다. 기존 업무 테이블과 `auth.users`/`auth.identities`의 계정·비밀번호·로그인 제공자는 수정하지 않습니다. `auth.users` 외래 키는 실제 Auth 사용자를 Supabase에서 삭제하면 해당 승인 행도 삭제하는 구조입니다.

```sql
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
```

성공 메시지를 확인한 뒤 다음 조회를 실행합니다. 오류가 나면 중단하고 오류 내용을 확인합니다. SQL 일부만 임의로 생략하거나 RLS를 해제해서 진행하지 않습니다. 위 설치는 트랜잭션 단위이며 실패 시 설치 성공으로 간주하지 않습니다.

### 1-3. 설치 결과 확인 SQL

다음은 조회만 하는 SQL입니다.

```sql
-- 테이블 생성과 RLS 활성 여부: 한 행, rls_enabled = true 예상
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'app_memberships';

-- 아래 3개 정책과 명령 종류가 있어야 합니다.
-- membership_read: SELECT / membership_request: INSERT / membership_approve: UPDATE
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'app_memberships'
order by policyname;

-- 세 함수가 모두 존재해야 합니다.
select to_regprocedure('public.app_is_admin()') as admin_check,
       to_regprocedure('public.app_is_company_admin(text)') as company_admin_check,
       to_regprocedure('public.app_guard_membership_update()') as update_guard;

-- guard_membership_update 트리거가 한 행, enabled = O 예상
select tgname, tgenabled as enabled
from pg_trigger
where tgrelid = 'public.app_memberships'::regclass and not tgisinternal;

-- authenticated만 SELECT/INSERT/UPDATE를 허용, DELETE는 허용하지 않습니다.
-- anon에는 네 권한 모두 허용하지 않습니다.
select role_name,
       has_table_privilege(role_name, 'public.app_memberships', 'SELECT') as can_select,
       has_table_privilege(role_name, 'public.app_memberships', 'INSERT') as can_insert,
       has_table_privilege(role_name, 'public.app_memberships', 'UPDATE') as can_update,
       has_table_privilege(role_name, 'public.app_memberships', 'DELETE') as can_delete
from (values ('anon'), ('authenticated')) as roles(role_name);
```

설치 직후 승인 행이 0개여도 정상입니다. 최초 앱 로그인 시 본인 승인대기 레코드가 생성됩니다. SQL Editor의 `postgres`는 RLS를 우회할 수 있으므로 이 조회 성공이 일반 사용자 접근 허용이나 실제 Google 로그인 성공을 의미하지는 않습니다.

### 적용되는 승인 규칙

- 본인 가입 요청은 회사/역할/권한 없는 `pending` 레코드만 삽입할 수 있습니다.
- 본인 승인 상태를 읽을 수 있지만 스스로 승인·회사·역할을 바꿀 수 없습니다.
- 승인된 회사 관리자는 자기 회사 사용자와 아직 회사가 지정되지 않은 신규 신청자를 조회합니다. 미배정 신청자의 이메일·표시명·신청 회사명이 관리자에게 보입니다.
- 회사 배정은 관리자가 관리하는 회사로만 가능합니다. 타사 관리와 마지막 활성 관리자 해제는 DB에서도 거부합니다.
- 일반 사용자에게 DELETE 권한을 주지 않습니다. 실제 Auth 사용자 삭제는 운영자의 Supabase 관리 절차를 따릅니다.

## 2. 기존 Render Web Service에 환경변수 추가

**새 Render 서비스를 만들지 않습니다.** 현재 서비스를 선택하고 Environment에 다음 값을 추가·검토합니다. 값은 Render 환경변수 입력 화면에 넣고 Git/채팅에 비밀값을 기록하지 마세요.

| 이름 | 값/용도 |
| --- | --- |
| `AUTH_MODE` | `supabase` |
| `SUPABASE_URL` | 해당 Supabase 프로젝트의 HTTPS URL |
| `SUPABASE_PUBLISHABLE_KEY` | 해당 프로젝트의 공개 publishable key |
| `SUPABASE_ANON_KEY` | 구형 공개 anon key 사용 시 위 key 대신 설정 |
| `AUTH_SITE_URL` | 기존 앱의 공개 원본 URL. 현재 서비스는 `https://app-project-7wyo.onrender.com` |
| `AUTH_SECURE_COOKIE` | `true` |
| `APP_ENV` | 실제 운영은 `production` |
| `DEMO_LOGIN_ENABLED` | 실제 운영은 `false` |

`SUPABASE_URL`/key는 API 런타임에서 읽습니다. `NEXT_PUBLIC_` 변수나 클라이언트 번들에 넣지 않습니다. 공개 key만 필요하며 **Supabase secret key/service-role key는 사용하지 않습니다.** 코드도 이 키를 거부합니다. Render 관리 API key도 앱 환경에 필요하지 않습니다.

Supabase key가 없거나 승인 테이블 연결에 실패하면 운영 로그인은 차단됩니다. 로컬 메모리 로그인이나 데모 관리자로 자동 전환하지 않습니다. 운영에서 DEMO_LOGIN_ENABLED만 true로 바꿔도 데모 계정은 생성되지 않습니다. 기존 체험 서비스를 계속 테스트용으로 쓸 때만 `APP_ENV=test`와 `DEMO_LOGIN_ENABLED=true`를 명시합니다. 테스트와 운영은 같은 실제 자료를 공유하지 않도록 분리해서 사용하세요.

현재 업무 저장소는 대부분 메모리 기반입니다. **인증·승인 영구화가 현장/견적/사진 등 기존 업무 자료의 영구화를 의미하지는 않습니다.** 이번 변경은 업무 자료 DB 이전을 포함하지 않습니다. 운영 환경은 공용 샘플 자료를 자동 생성하지 않습니다. 기존 견적서 회사 기본 프로필/양식은 유지합니다.

## 3. Redirect URL 확인

Supabase Authentication URL Configuration:

- Site URL: 기존 앱의 공개 원본 URL
- Redirect URLs: `https://app-project-7wyo.onrender.com/api/auth/callback`
- 로컬 검증 시 별도 허용: `http://localhost:3000/api/auth/callback`

Google Cloud Console의 승인된 리디렉션 URI는 앱 URL이 아니라 **Supabase가 안내한 프로젝트의 `/auth/v1/callback` URL**입니다. 이 설정과 앱의 Redirect URLs는 서로 다릅니다. Google Provider 설정을 다시 만들 필요 없이 정확한 콜백 경로가 허용되어 있는지 확인하세요.

로그인/계정 연결 시작 시 PKCE verifier를 HttpOnly 쿠키에 저장합니다. 콜백의 code를 Supabase와 교환한 후 query를 업무 화면에 전달하지 않고 `/`로 이동합니다. 요청에서 받은 임의의 redirect URL로 이동하지 않습니다.

## 4. 첫 실제 관리자 지정: 실제 연결 준비 후 별도로 직접 실행

**지금은 실제 연결 검증을 보류 중이므로 이 단계도 보류합니다.** 환경변수 전달과 앱 연결을 준비한 뒤 진행합니다. 기존 데모 관리자는 실제 Supabase 사용자를 승인하는 수단이 아닙니다.

### 4-1. 실제 로그인과 UUID 확인

1. 의도한 첫 관리자 계정으로 앱에서 이메일/Google 로그인을 합니다. 승인대기 화면이 정상입니다.
2. Supabase **Authentication → Users**에서 해당 계정의 이메일·로그인 제공자와 **User UID(UUID)**를 직접 대조합니다. 이메일 문자열로 일괄 승인하거나 `user_metadata.role`을 신뢰하지 않습니다.
3. SQL Editor에서 아래 조회의 `<확인한_사용자_UUID>` 한 곳을 실제 UUID로 바꿔 실행합니다. 이 표기는 그대로 실행할 수 없는 자리표시자입니다.

```sql
select u.id as auth_user_id, u.email as auth_email,
       m.user_id, m.email as approval_email, m.display_name,
       m.company_id, m.role, m.approval_status, m.active, m.locked
from auth.users u
left join public.app_memberships m on m.user_id = u.id
where u.id = '<확인한_사용자_UUID>'::uuid;
```

예상 결과는 **한 행**이며 `user_id`가 확인한 UUID, `company_id`/`role`이 `null`, `approval_status`가 `pending`, `active`/`locked`가 `false`입니다. 0행이면 UUID를 확인합니다. Auth 사용자는 있지만 `m.user_id`가 `null`이면 앱의 승인대기 레코드 생성이 아직 완료되지 않은 것입니다. 연결·설치 오류를 확인하고 앱 로그인을 다시 시도한 뒤 확인합니다. 레코드를 임의로 만들거나 다른 사용자의 행을 대신 승인하지 않습니다.

### 4-2. 첫 관리자 한 명만 승인

기존 앱의 기본 회사 ID는 **`jongro`**입니다. 이것은 화면 회사명이 아니라 서버에서 사용하는 ID입니다. 다른 ID를 사용하려면 그 회사가 앱 서버에도 등록되어 있어야 합니다. 임의의 회사명을 `company_id`에 넣지 않습니다.

다음 SQL의 UUID 한 곳을 위에서 확인한 값으로 바꾼 뒤 **별도 쿼리로 직접 실행**합니다. 이 쿼리는 아직 회사·역할이 없는 정상 pending 사용자 한 명만 대상으로 합니다.

```sql
begin;
update public.app_memberships as m
set company_id = 'jongro',
    role = 'admin',
    approval_status = 'approved',
    active = true,
    locked = false
where m.user_id = '<확인한_사용자_UUID>'::uuid
  and m.company_id is null
  and m.role is null
  and m.approval_status = 'pending'
  and m.active = false
  and m.locked = false
  and exists (select 1 from auth.users u where u.id = m.user_id)
returning user_id, email, company_id, role, approval_status, active, locked;
commit;
```

반환 결과가 **정확히 한 행**이고 대상 이메일/UUID와 `jongro` / `admin` / `approved` / `active=true` / `locked=false`가 맞는지 확인합니다. 0행이면 이미 승인됐거나 상태가 달라진 것이므로 4-1의 조회로 확인합니다. 조건이나 WHERE 절을 제거하여 다시 실행하지 않습니다. 1단계 설치 SQL만 재실행해도 관리자가 승인되지는 않습니다.

### 4-3. 앱에서 승인 확인과 후속 사용자 관리

1. 첫 관리자 계정으로 앱의 **승인 상태 다시 확인**을 누릅니다. 필요하면 다시 로그인합니다.
2. 관리자 업무 화면과 사용자 관리 접근을 확인합니다. 실제 연결이 재개된 시점에 검증 결과를 기록합니다.
3. 이후 신규 사용자는 관리자의 **사용자 관리**에서 회사·역할·승인 상태를 지정합니다. 첫 관리자 SQL을 다른 사용자에게 반복 적용할 필요는 없습니다.
4. 작업진행자는 기존 작업진행자 레코드도 연결하고, 사내직원은 허용 현장·추가 권한을 지정합니다. 관리자에게 다른 사용자의 비밀번호 설정 기능은 제공하지 않습니다.

DB 저장값과 앱 표시 역할은 `admin`=관리자, `staff`=사내직원, `worker`=작업진행자, `customer`=고객입니다. 승인 상태는 `pending`=승인대기, `approved`=승인, `rejected`=거절, `inactive`=비활성입니다.

고객 역할은 인증·승인을 저장하지만 기존 앱에 고객 전용 업무 화면이 없으므로 사내 자료 접근을 허용하지 않습니다. 실제 계정의 사용자명·이메일·비밀번호 변경 UI는 이번 통합 범위에 포함하지 않으며 기존 데모 프로필 편집과 구분합니다.

## 5. 세션 유지와 모바일/PWA

Supabase SSR SDK의 HttpOnly·SameSite=Lax 쿠키를 사용합니다. 운영은 Secure 쿠키이며, refresh token으로 만료된 세션을 갱신할 때 응답에 새 쿠키를 씁니다. 서버 재시작 시 메모리 로그인 세션을 복원하는 방식이 아니므로 승인 테이블과 Supabase 세션이 유효하면 재로그인 없이 계속 사용할 수 있습니다. 브라우저 JS에 access/refresh token을 반환하지 않습니다. 로그아웃은 현재 Supabase 세션을 종료하고 해당 쿠키를 삭제합니다.

기존 서비스 워커는 인증/API 응답을 캐시하지 않습니다. 모바일 브라우저/PWA의 같은 설치 환경에서 세션을 유지합니다. iOS에서는 설치된 PWA와 Safari가 서로 다른 저장 공간을 사용할 수 있으므로 서로 다른 앱/프로필 사이의 자동 로그인 공유는 보장하지 않습니다.

## 검증 및 현재 필요한 외부 작업

로컬 인증 테스트는 모의 Supabase 공급자를 사용해 SDK 이메일 로그인, PKCE 코드 검증, HttpOnly 쿠키, 갱신, 재시작 후 유지, 승인 전 차단과 권한 회수를 확인합니다. RLS 마이그레이션은 PGlite PostgreSQL에서 자기 승인/타사 접근/마지막 관리자 해제 차단을 별도로 검증합니다. 모의 공급자 검증은 실제 Google 로그인 성공의 증거가 아닙니다.

실제 연동 검증에는 프로젝트 URL/공개 key, SQL 설치, 초기 관리자 UUID와 사용자 본인의 Google 인증·동의가 필요합니다. Google 비밀번호나 service-role key를 채팅으로 전달하지 마세요. 코드의 GitHub main 반영·기존 Render 배포 및 로그인 버튼 표시 확인은 진행할 수 있습니다. 실제 Supabase·Google 로그인과 승인 SQL 실행은 별도로 재개하기 전까지 보류합니다.

### 로컬 검증 기록 (2026-10-19)

- `npm run build`: 성공
- `npm run typecheck`: 성공
- `npm test`: 94개 통과, 실패/건너뜀 0
- PC 1440×1000, iPhone 크기 390×844, Android 크기 412×915에서 이메일 로그인 → 승인대기 → 새로고침 세션 유지 → 로그아웃 검증(모의 Supabase). HttpOnly·영속 쿠키 및 관리자 UI의 회사·역할 배정/승인도 검증합니다.
- PKCE 콜백·만료 세션 갱신·API 재시작 후 인증 유지·동일 UUID 제공자 연결은 모의 공급자 테스트입니다. 실제 Google 인증 성공으로 간주하지 않습니다.

브라우저 검증을 재실행하려면 빌드 후 로컬 포트 3000/4000을 비우고 저장소 루트에서 다음을 실행합니다. Playwright와 Chromium이 필요하며 실제 프로젝트 값 대신 명시적인 테스트 공급자를 실행합니다.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node node_modules/tsx/dist/cli.mjs --tsconfig apps/api/tsconfig.json scripts/verify-supabase-ui.ts
```


### Render 로그인 버튼과 환경변수

클라우드 개발 환경의 변수 등록이 Render Web Service로 복사되지는 않습니다. 기존 Render 서비스의 Environment에 `SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`를 직접 등록해야 합니다. 값은 문서나 코드에 적지 않습니다. 실제 운영은 위 표의 `AUTH_MODE=supabase`, `AUTH_SITE_URL`, `APP_ENV=production`, `AUTH_SECURE_COOKIE=true`, `DEMO_LOGIN_ENABLED=false`도 확인합니다.

운영 로그인 화면에는 **이메일 로그인**, **Google로 계속하기**, **가입 신청**을 표시합니다. 두 Supabase 변수가 없으면 Google 버튼을 비활성화하고 설정 안내를 표시합니다. 버튼 표시·배포 SHA 확인은 실제 Google 로그인 성공이나 승인 테이블 설치 완료를 의미하지 않습니다.

### 운영의 로그인 없는 체험 기능

운영 체험은 개발용 demo 로그인과 별개입니다. `DEMO_LOGIN_ENABLED=false`를 유지하며 별도 체험 세션/회사를 사용합니다. 실제 사용자는 체험 회사에 배정할 수 없습니다. [체험 모드와 운영자가 직접 적용할 추가 SQL](trial-mode.md)을 참고하세요. 추가 SQL은 `002-supabase-auth.sql` 뒤에 실행하며 자동 실행하지 않습니다.

### 가입 승인 요청 UX와 제공자 조회

관리자 홈/사용자 관리의 전용 승인 절차와 Google 계정 연결 오류 안내는 [가입 승인 관리](signup-approval.md)를 참고하세요. 다른 사용자의 검증된 로그인 제공자와 실제 Auth 가입일 조회에는 `004-membership-providers.sql`을 SQL Editor에서 직접 설치해야 합니다. 미설치 시에도 승인·거절은 동작하며 제공자는 확인 필요로 표시합니다.

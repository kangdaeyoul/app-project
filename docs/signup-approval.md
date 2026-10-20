# 가입 승인 관리와 Google 계정 연결

운영 Supabase 로그인과 기존 체험 모드를 유지합니다. Secret/service-role key를 사용하지 않습니다.

## 관리자 승인 흐름

1. 관리자 홈의 `가입 승인대기 N명` 카드를 누르면 사용자 관리의 `가입 승인 요청 N건` 영역으로 이동합니다. PC와 모바일에서 동일하게 동작합니다.
2. 이름·이메일·가입일·신청 회사·로그인 제공자를 확인합니다. `상세보기`로 같은 정보를 확인할 수도 있습니다.
3. `승인하기` → 소속 회사·역할 선택 → 직원의 현장/추가 권한 또는 작업진행자 연결을 지정 → `승인 완료`를 누릅니다. 회사는 현재 관리자가 관리하는 회사만 선택할 수 있습니다.
4. 서버가 `approval_status=approved`, `active=true`, 회사·역할·접근 범위를 저장합니다. 사용자는 기존 세션에서 `승인 상태 다시 확인`을 눌러 승인된 역할의 화면으로 이동합니다. 고객은 기존의 고객 전용 화면 준비 중 안내를 유지합니다.
5. `거절`은 확인 후 `rejected`, `active=false`로 저장합니다. Auth 사용자를 삭제하지 않습니다. 거절 행은 검토한 회사에 귀속하며 다른 회사의 미배정 요청 목록에서 숨깁니다. 이름/이메일과 Auth 제공자는 변경하지 않습니다.

기존 사용자 수정은 그대로 유지합니다. 전용 승인/거절 API는 pending인 행만 원자적으로 수정하므로 중복 클릭이나 다른 관리자의 선행 처리를 덮어쓰지 않습니다. 관리자 홈/사용자 목록은 30초 간격과 포커스 복귀 시 갱신합니다. 사용자의 승인 상태 확인은 즉시 서버에서 조회합니다.

## 로그인 제공자 조회용 SQL: 운영자가 직접 실행

기존 승인 테이블 설치 후 Supabase SQL Editor에서 아래 SQL을 실행합니다. 파일 원본은 [004-membership-providers.sql](../apps/api/migrations/004-membership-providers.sql)입니다. 이 작업에서 운영 Supabase SQL을 자동 실행하지 않습니다.

이 함수는 검증된 `auth.identities`의 제공자와 `auth.users`의 가입일만 반환합니다. 이메일로 계정을 병합하거나 user_metadata를 로그인 제공자의 근거로 사용하지 않습니다. 승인된 관리자는 자기 회사 사용자와 미배정 신청자만 조회합니다. 일반 사용자와 타사 정보는 조회할 수 없고 익명 호출 권한도 없습니다.

```sql
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
```

함수가 없거나 조회할 수 없으면 기존 로그인·승인·거절은 계속 동작합니다. 로그인 제공자는 `확인 필요`로 표시하며 임의로 이메일/Google로 추측하지 않습니다. 가입일은 함수 설치 전에는 membership의 생성일을 표시하고, 설치 후에는 실제 Auth 가입일을 표시합니다.

## Google 계정 연결 오류

승인대기 화면과 로그인한 사용자의 헤더에서 Google 계정 연결을 요청하면 오류를 현재 화면에 한국어로 표시합니다. Supabase 수동 계정 연결이 꺼져 있으면 관리자에게 `Enable manual linking` 설정을 확인하도록 안내합니다. 이 오류 때문에 기존 세션을 종료하지 않습니다.

서버 로그 `google_identity_link_failed`에 Supabase 오류 코드(제공된 경우), HTTP 상태, 오류 메시지를 기록합니다. 비밀번호·세션 토큰·키·전체 요청/사용자 객체는 기록하지 않습니다. 기존 Google 로그인 리디렉션과 계정 연결의 PKCE 방식은 유지합니다.

## 검증

- 빌드·타입 검사 및 API 테스트 101개 통과.
- 로컬 Chromium에서 PC/사내직원, iPhone 크기/관리자, Android 크기/작업진행자 승인, 홈 배지 이동, 상세보기, 승인 후 즉시 업무 진입, 거절, 기존 사용자 수정, 계정 연결 오류의 한국어 표시를 검증합니다. Supabase는 모의 공급자이며 실제 가입자를 변경하지 않습니다.
- 승인 권한·필수 작업진행자 연결·중복 처리 방지·거절 시 Auth 유지와 제공자 조회 함수의 회사별 범위·익명 차단은 별도 테스트로 검증합니다. SQL 테스트는 임시 PGlite DB에서만 실행합니다.
- 운영 SQL은 직접 실행해야 하며, 실제 Google 인증·계정 연결 성공 검증은 별도입니다.

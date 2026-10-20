# 이메일 가입 및 승인 흐름 완성

## 적용 내용

- 이메일 가입 실패: Supabase code/status/message에 따라 중복 이메일, 비밀번호 정책(길이·문자 종류·유출 비밀번호), 이메일 형식, 이메일 발송 제한, 서버/Provider 오류를 한국어로 구분합니다.
- 서버 로그는 진단 필드만 기록하고 비밀번호·이메일·휴대전화 입력값, JWT, 토큰·키 패턴을 마스킹합니다. 전체 요청/SDK 세션 객체를 기록하지 않습니다.
- 가입 성공 안내: `가입 신청이 완료되었습니다. 이메일 인증 후 로그인해 주세요. 관리자의 승인 후 업무공간을 사용할 수 있습니다.`
- Auth metadata에 이름·휴대전화·신청 회사·희망 역할을 저장합니다. 희망 역할 키는 `requested_role`이며 실제 권한 `role`과 분리합니다.
- 관리자 사용자관리 최상단의 가입 승인 요청에 이름·이메일·휴대전화·신청 회사·희망 역할·가입일·검증된 로그인 제공자·승인대기 상태를 표시합니다. 기존 승인하기/거절/상세보기·승인 모달·홈 알림·모바일 버튼을 유지합니다.

## 운영자가 직접 실행할 SQL과 순서

**운영 Supabase SQL은 자동 실행하지 않습니다.** 기존 테이블과 첫 관리자 행을 삭제하거나 재생성하지 마세요.

1. 기존 `002-supabase-auth.sql` 승인 테이블 설치를 확인합니다. 이미 설치했다면 재설치할 필요가 없습니다.
2. `003-trial-isolation.sql`이 미설치라면 기존 체험 격리 보강용으로 직접 적용합니다.
3. `004-membership-providers.sql`이 미설치라면 관리자용 검증된 로그인 제공자 조회를 위해 직접 적용합니다.
4. 새 [005-signup-profile.sql](../apps/api/migrations/005-signup-profile.sql) **전체**를 Supabase SQL Editor에서 `postgres` 역할로 실행합니다.
5. 아래 조회로 새 열·트리거·기존 관리자 보존을 확인하고 테스트 계정으로 가입/인증/승인을 검증합니다.

005는 `phone`, `requested_role`, `registered_at` 열을 추가하고 신규 Auth 사용자에게 회사/실제 역할 없는 pending 행을 만듭니다. 기존 Auth metadata에 저장돼 있던 가입 참고 정보는 빈 열만 채웁니다. 기존 회사·실제 역할·승인·활성·잠금 상태와 이름·이메일은 덮어쓰지 않습니다. 기존 레코드가 없는 Auth 사용자만 새 pending 행을 만듭니다. 같은 SQL을 재적용해도 기존 승인 결정을 초기화하지 않습니다.

가입 참고 정보는 최초 membership 생성 시 캡처합니다. 이후 사용자가 Auth metadata를 바꾸더라도 실제 역할·회사·승인을 바꾸지 않습니다. 예전 코드가 Auth metadata에 저장하지 않은 휴대전화/희망 역할은 복구할 수 없어 미입력으로 표시합니다. 005 설치 전 가입도 Auth metadata에는 새 정보를 보존하며 005 적용 시 회수할 수 있지만, 관리자 카드의 새 정보 표시는 SQL 적용 후 확인해야 합니다.

기존의 별도 Auth 가입 트리거가 있다면 아래 조회로 함께 확인하세요. 새 트리거는 충돌 시 기존 membership을 유지합니다. 기존 사용자 정의 트리거를 임의로 삭제하지 않습니다.

```sql
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='app_memberships'
  and column_name in ('phone','requested_role','registered_at');

select tgname, tgrelid::regclass as target, tgenabled,
       pg_get_triggerdef(oid)
from pg_trigger
where tgrelid in ('auth.users'::regclass,'public.app_memberships'::regclass)
  and not tgisinternal;

select user_id, email, phone, requested_company, requested_role,
       registered_at, company_id, role, approval_status, active, locked
from public.app_memberships
order by created_at desc;
```

새 열이 REST 응답에 아직 반영되지 않으면 SQL Editor에서 아래 스키마 캐시 갱신을 직접 실행한 뒤 새로고침합니다.

```sql
notify pgrst, 'reload schema';
```

## 이메일 중복과 Supabase 보안 응답

`user_already_exists`/`email_exists` 및 기존 계정의 성공 마스킹 응답(`identities=[]`)을 중복 안내로 처리합니다. 중복을 확인한 응답을 가입 성공으로 표시하지 않습니다. 기존 계정의 권한/프로필을 앱에서 덮어쓰거나 별도 membership을 만들지 않습니다.

Supabase의 계정 존재 여부 보호 설정에 따라 **미인증 기존 계정**에는 동일 사용자에 대한 인증 메일 재발송 응답이 올 수 있습니다. 공개 키만으로 모든 이메일 존재 여부를 미리 조회할 수는 없습니다. 이를 우회하는 공개 이메일 검색 RPC나 service-role key는 추가하지 않습니다. Supabase는 동일 이메일의 별도 Auth 사용자를 중복 생성하지 않습니다. 실제 설정에서 이 동작도 계정 소유자가 확인해야 합니다.

## 직접 검증 순서

1. 테스트용 이메일로 이름·휴대전화·신청 회사·희망 가입유형을 입력해 가입합니다.
2. 이메일 수신함에서 Supabase 인증 링크를 열고 이메일 인증을 완료합니다. 링크는 채팅에 보내지 않습니다.
3. 앱에서 로그인하여 승인대기 화면과 업무 접근 차단을 확인합니다.
4. 기존 관리자로 로그인 → 홈 `가입 승인대기 N명` → 사용자 관리의 `승인하기` → 소속 회사·실제 역할·연결 작업진행자/현장/추가 권한 → `승인 완료`.
5. 가입자 화면에서 `승인 상태 다시 확인`을 눌러 재로그인 없이 승인된 역할로 진입합니다. 고객 전용 화면은 기존 준비 중 안내를 유지합니다.
6. 같은 인증 완료 이메일로 다시 가입해 중복 안내를 확인합니다.
7. 새 Google 계정으로 로그인하여 pending 생성, 기존 계정에서는 Manual Linking 활성화 후 Google 계정 연결을 확인합니다.
8. 로그인 없이 체험하기의 역할별 진입·예시 초기화/재생성도 확인합니다. 실제 가입 정보와 체험 자료는 이전/병합하지 않습니다.

자동 검증의 이메일 인증·Google OAuth는 모의 공급자와 임시 DB를 사용합니다. 실제 수신함의 이메일 인증 링크와 Google 계정 동의는 계정 소유자의 직접 검증이 필요하며, 모의 검증을 실제 인증 성공으로 보고하지 않습니다.

## 검증 기록

- 빌드·타입 검사, API 전체 테스트 105개 통과.
- 가입 오류 분류·요구조건 안내·중복 마스킹 응답·로그 민감정보 제거, 신규 가입의 메타데이터 보존을 검증합니다.
- 임시 PGlite에서 005 적용·재적용, 기존 관리자 보존, 신규 pending 생성과 자기 승인 차단을 검증합니다. 운영 SQL 실행과 구분합니다.
- 로컬 Chromium에서 신규 가입 성공 문구·휴대전화/희망 역할 표시·모의 이메일 인증·관리자 승인·재로그인 없는 진입·중복 안내를 검증합니다.
- PC/직원, iPhone 크기/관리자, Android 크기/작업진행자의 승인 모달과 계정 연결 오류 안내, 체험판의 역할별 진입·초기화/재생성·튜토리얼 재시작도 회귀 검증합니다.
- 실제 운영 이메일 인증과 Google 동의는 배포 후 사용자가 직접 진행하고 결과를 확인합니다.

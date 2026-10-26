# 회사 등록·초대·다중 회사 로그인

## 기존 구조와 변경 원칙

기존 Supabase Auth UUID/이메일/비밀번호/Google 제공자를 유지한다. `public.app_memberships`의
사용자당 1행 기본키를 UUID 멤버십 기본키와 `(company_id,user_id)` 유일성으로 확장했다.
별도의 중복 사용자/멤버십 테이블은 만들지 않는다. 회사는 기존 `app_core.companies`를 재사용한다.
기존 `jongro` 회사와 승인된 사용자 역할/현장/진행자 연결/권한은 변경하지 않는다.
CORE_STORAGE, CORE_DATABASE_URL, Session Pooler URI 및 SSL 정규화/진단 코드는 변경하지 않는다.

## 007 SQL과 배포 순서 (운영자 직접 실행)

1. 운영 DB 백업 및 현재 회사/사용자 연결을 확인한다. 기존 002~006은 재실행하지 않는다.
2. Supabase SQL Editor에서 `apps/api/migrations/007-company-onboarding.sql` **전체를 직접 실행**한다.
   앱은 SQL을 자동 적용하지 않는다. 데이터 삭제/초기화는 포함하지 않는다.
3. 새 코드를 기존 서비스에 배포하고 API를 재시작한다. `CORE_STORAGE=postgres`와 정상 동작 중인
   `CORE_DATABASE_URL` 및 SSL 옵션을 그대로 유지한다. 새 Render 서비스는 필요 없다.
4. `/api/auth/config`의 companyOnboardingEnabled=true를 확인한다. 007이 없으면 새 가입 API는
   준비 중으로 응답하며 기존 단일 회사 인증 경로를 유지한다. 새 기능을 위해 메모리 fallback은 하지 않는다.
5. 기존 관리자 로그인, `/c/jongro`, 새 업체 등록과 이메일 인증, 직원/진행자 초대·승인·회사 선택을 확인한다.

추가 service-role key/공개 secret/DB URL 환경변수는 필요 없다. 기존 SUPABASE_URL,
SUPABASE_PUBLISHABLE_KEY(또는 ANON_KEY), AUTH_MODE=supabase, AUTH_SITE_URL, AUTH_SECURE_COOKIE를
유지한다. 이메일 가입과 인증 메일 발송이 Supabase에서 사용 가능해야 한다. 기존 Google callback인
`/api/auth/callback`을 계속 사용하므로 별도 회사별 OAuth redirect 등록은 필요 없다.

마이그레이션 후 구버전의 `ON CONFLICT(user_id)`에 의존하는 외부 스크립트가 있다면 함께 점검한다.
새 기본키는 memberships.id이며 사용자 UUID는 user_id 그대로다. 002~006을 거꾸로 재적용하면
다중 회사 구조와 정책을 훼손할 수 있으므로 사용하지 않는다.

## 테이블·컬럼

- `app_core.companies`: `slug`(고유 회사 전용 주소), `active` 추가. 기존 `jongro`의 slug는 jongro.
  나머지 기존 회사는 충돌하지 않는 결정적 주소를 부여한다. 신규 회사는 무작위 내부 ID와 주소를 생성한다.
  회사명/로고/대표자/사업자번호/연락처/주소는 기존 payload/Company 모델과 설정을 재사용한다.
- `public.app_memberships`: `id`, `approved_at`, `approved_by` 추가. 기존 user_id와 auth.users 참조 유지.
  `(company_id,user_id)` 고유 인덱스, 회사 미지정 사용자당 1행 부분 고유 인덱스, 회사 FK를 추가한다.
  기존 행 검증 때문에 운영 적용이 중단되지 않도록 회사 FK는 NOT VALID로 추가하며 신규 변경에는 적용된다.
- `app_core.company_invites`: 회사/직원 또는 진행자 역할/해시 토큰/생성자/만료/활성 상태.
  원문 토큰은 생성 응답에서 한 번만 반환한다. 목록에는 다시 노출하지 않는다.
- `app_core.onboarding_intents`: 이메일에 묶인 서버 발급 일회용 가입 요청. 해시 토큰/종류/회사 프로필
  또는 초대 참조/만료/소비 시점을 저장한다. 비밀번호나 원문 토큰은 저장하지 않는다.

## 신규 API

| 메서드 | 경로 (`/api` 기준) | 권한/기능 |
|---|---|---|
| GET | /tenant/companies/:slug | 공개 회사명·로고·주소명만 조회; 업무/연락처/회원 목록은 반환하지 않음 |
| GET | /tenant/invites/:token | 유효 초대의 회사 브랜딩·지정 역할·만료 확인 |
| POST | /tenant/register | 새 업체 최초 관리자 또는 초대 가입; 회사/역할은 서버 결정 |
| POST | /tenant/invites/:token/apply | 검증된 기존 Supabase 계정의 다른 회사 가입 신청 |
| POST | /tenant/company-selection | 승인된 본인 멤버십 선택; HttpOnly 회사 선택 쿠키 설정 |
| GET/POST | /tenant/invitations | 현재 회사 관리자만 초대 목록/생성 (7일 만료) |
| PUT | /tenant/invitations/:id/revoke | 현재 회사 관리자만 초대 비활성화 |
| GET/PUT | /tenant/branding | 현재 회사 관리자만 전용 주소 조회/변경 |

기존 /auth/login, /auth/me, /users, /users/:id/approval, /users/:id 및 가입 승인 수 계산을 확장했다.
기존 회사 프로필/로고 설정과 `/api/company/branding/logo`는 유지한다. 공개 로그인은 그 회사의
로고 데이터/HTTPS 주소만 제한적으로 투영하며 기존 보호된 로고 파일 API를 공개하지 않는다.

## 화면과 동작

- `/`: 공통 로그인과 새 업체 등록. 최초 화면에서는 역할을 선택하지 않으며 실제 권한은 서버 멤버십이 결정한다.
- `/c/[companySlug]`: 회사 브랜딩 로그인. 잘못된 주소는 존재하지 않는 업체 화면을 표시한다.
  이미 로그인한 경우 승인된 해당 회사만 선택하며 다른 회사 업무를 해당 URL에 조용히 표시하지 않는다.
- `/join/[inviteToken]`: 회사·역할 고정 가입. 기존 계정은 로그인 상태에서 가입 신청할 수도 있다.
- 로그인 후 승인된 회사 1개면 자동 연결, 여러 개면 업체 선택. 세션 메뉴에서 업체를 전환할 수 있다.
- 승인대기/거절/비활성 계정은 업무 화면으로 진입하지 않는다. admin/staff/worker의 기존 역할별 화면 유지.
- 사용자 관리에 사용중/승인대기/거절/초대링크 구분을 추가했다. 회사 전용 주소와 초대 관리는 초대링크 탭에 있다.
  회사 프로필·로고·대표자·사업자번호·주소·전화는 기존 회사 설정에서 수정한다.
- 회사 active 필드는 DB와 접근 검증에 반영한다. 회사 전체 비활성/복구는 이번 UI의 자기 차단을 피하기 위해
  운영자 SQL 관리 대상으로 유지한다. 사용자 비활성화와 초대 비활성화는 관리자 UI에서 가능하다.

## 보안·가입 트랜잭션

서버가 무작위 등록 요청 토큰을 만들고 해시만 저장한 후 Supabase 가입 메타데이터에 원문을 전달한다.
Auth 사용자 생성 트리거는 해시/이메일/만료/소비 여부를 확인하고 회사+최초 관리자 멤버십을 같은
DB 트랜잭션에서 생성한다. 유효한 서버 요청 없이 raw_user_meta_data.role/company_id를 보내도
권한은 부여되지 않는다. 만료/위조된 가입 요청은 거절한다. 기존 일반/OAuth 가입은 회사 미지정으로만
생성되며 어떤 회사에도 자동 연결하지 않는다. 초대 토큰의 회사/역할은 DB에서 재검증한다.
기존 계정의 추가 가입은 초대·회사 활성 상태를 잠그고 `(company_id,user_id)` 중복을 차단한다.

선택 쿠키는 회사 선택 힌트일 뿐 권한 증거가 아니다. 매 요청마다 Supabase getUser와 DB 멤버십의
소속/승인/활성/잠금/역할을 검증한다. 다른 회사로 위조하면 거절한다. 기존 회사 문맥과 복합 FK,
업무 트랜잭션, 현장 배정 검사 및 재무 필드 제거를 유지한다. 별도 DB 연결을 생성하지 않고 기존 풀과
요청 트랜잭션을 재사용해 승인/설정 변경 시 잠금 충돌을 피한다.

RLS는 자기 멤버십 또는 해당 회사 활성 관리자만 조회·수정할 수 있게 좁혔다. 회사 미지정 신청자는
아무 관리자에게도 공개하지 않는다. 멤버십이 배정된 회사는 바꿀 수 없다. 마지막 활성 관리자 보호를 유지한다.
초대는 회사 관리자만 조회하며 쓰기는 서버 API로 제한한다. 가입 요청 테이블은 클라이언트 접근을 막는다.
만료된 가입 요청·초대는 남겨 두며 자동 데이터 삭제 작업은 추가하지 않았다.

## 기존 계정의 부족한 멤버십

기존 승인된 jongro 멤버십은 그대로 유지한다. 회사가 NULL이거나 진행자 연결이 잘못된 계정은
임의로 jongro 또는 새 회사에 배정하지 않는다. 본인이 유효한 초대 링크로 가입 신청하거나 운영자가
Auth UUID와 실제 소속을 확인한 후 별도 SQL로 복구해야 한다. 한 사용자가 여러 회사에 있을 때
승인/거절/역할 변경은 현재 회사의 그 멤버십에만 적용된다.

## 검증

- npm run typecheck / npm run build / npm test 실행 결과는 종료 보고에 기재한다.
- 신규 로컬 PGlite 통합 테스트는 실제 002~007 및 007 재실행, 신규 회사/관리자, 프로필, 직원/진행자
  초대·가입, pending 차단·승인·거절, 타사 승인/업무 접근 차단, 다중 회사 선택, 마지막 관리자,
  잘못된/만료/비활성 초대, 회사 주소 수정, 기존 jongro 로그인, 디스크 DB 재시작을 검증한다.
- `node scripts/verify-tenant-ui.cjs`: 프로덕션 Next 페이지 + 모의 API로 PC/태블릿/모바일 화면·입력·선택·오류 경로 검사.
- `TSX_TSCONFIG_PATH=apps/api/tsconfig.json node --import tsx --import ./apps/api/test/environment.cjs scripts/verify-supabase-ui.ts`:
  기존 Supabase 모의 제공자 기반 이메일 세션/승인 UI/쿠키/로그아웃 회귀. 두 브라우저 스크립트는
  Playwright와 Chromium이 설치된 로컬 검증 환경에서 사용한다. 실 Supabase나 Google에 접속하지 않는다.

운영 SQL 적용·운영 브라우저 검증·Render 배포는 이 문서의 로컬 테스트로 완료 처리하지 않는다.

최종 로컬 검증 결과: TypeScript typecheck 통과, 전체 production build 통과(신규 동적 라우트 포함),
전체 자동 테스트 116개 통과(실패/건너뛰기 0). 신규 회사/멤버십·RLS·재시작 통합 테스트 포함.
브라우저 검증은 PC(1440px)/태블릿(834px)/모바일(390px)의 신규 화면·기존 계정 초대 로그인 전환·
주소/초대 오류·선택 흐름·가로 넘침 없음을 확인했고, 기존 이메일/승인 UI는 PC/iPhone/Android에서 통과했다.
운영 SQL 적용, GitHub push 및 Render 배포는 이 작업에서 수행하지 않았다.

## 변경 파일 전체 목록

- apps/api/src/tenant-onboarding.ts
- apps/api/src/tenant.controller.ts
- apps/api/src/supabase-auth.ts
- apps/api/src/core-persistence.ts
- apps/api/src/company-identity.ts
- apps/api/src/auth.ts
- apps/api/src/app.module.ts
- apps/api/migrations/007-company-onboarding.sql
- apps/api/test/tenant-onboarding.test.ts
- apps/api/test/supabase-fixture.ts
- apps/admin-web/app/page.tsx
- apps/admin-web/app/workspace.tsx
- apps/admin-web/app/auth-provider.tsx
- apps/admin-web/app/tenant-entry.tsx
- apps/admin-web/app/tenant-admin.tsx
- apps/admin-web/app/users-panel.tsx
- apps/admin-web/app/globals.css
- apps/admin-web/app/c/[companySlug]/page.tsx
- apps/admin-web/app/join/[inviteToken]/page.tsx
- scripts/verify-tenant-ui.cjs
- scripts/verify-supabase-ui.ts
- docs/company-onboarding.md

로그인 UI 간소화와 제공자 표시 설정은 `docs/login-ui.md`를 참고한다. 회사·초대·승인 로직은 유지한다.

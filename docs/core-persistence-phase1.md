# 업무 영구저장 1단계

기준: `6065956f9ccdef470fdf98b0c6b730275322ce12`. 기존 화면/API를 유지하는 단계적 전환이다.
SQL은 앱에서 실행하지 않으며 기존 메모리를 임의로 이관/삭제하지 않는다.

## 수정 전 구조 조사

공유 업무 타입/인터페이스는 `packages/shared/src/index.ts`에 있다. `AuthMembership`은 supabase-auth.ts, `StoredFile`은 file-storage.ts, 견적 내부 정규화 record는 quotes.repository.ts에 별도로 정의된다. 아래 파일은 별도 언급이 없으면
`apps/api/src/`, 화면은 `apps/admin-web/app/` 기준이다. 저장소 인터페이스는 각 repository 파일에 정의되어 있다.

| 데이터 / 공유 모델 | 저장소와 생성·조회·수정·삭제 진입점 | 사용하는 화면 | 기존 재시작 / 이번 단계 |
|---|---|---|---|
| 회사 `Company`, `CompanyMembership` | `company-context.ts` Map; `company.controller.ts` GET current, PUT settings/quote-preferences; quote-assets | quote-company-settings/editor/dialog, onboarding, page | 프로필 초기화 → postgres 모드에서 companies 보존 |
| 실제 사용자 `CurrentUser`, 인증 멤버십 `AuthMembership` | `supabase-auth.ts`; `auth.ts` AuthController / UsersController; Supabase Auth 및 public.app_memberships | auth-provider, account-forms, users-panel, user-permissions | 이미 Supabase 영구저장; 비밀번호/계정 테이블 복제 안 함 |
| 데모 사용자·세션 | `auth.ts` MemoryAuthProvider users/sessions/attempts Map | auth-provider, account-forms 및 users-panel의 데모 | 메모리 유지; 실제 인증과 분리 |
| 거래처 `Customer` | `customers.repository.ts`; `quotes.service.ts`; `app.module.ts` CustomersController GET/POST/PUT/DELETE customers | quote-customer-directory/picker, sites-panel | 초기화 → customers, 소프트 삭제 |
| 현장 `Site`, `SiteInput` | `sites.repository.ts`, `sites.service.ts`; app.module SitesController GET/POST/PUT/DELETE sites | sites-panel, business-panels, operational-workspace, 대시보드 | 초기화 → sites; 삭제는 archive |
| 작업진행자 `Worker`, `WorkerAvailability`, `WorkerWork` | workers.repository/service; app.module WorkersController; operational.controller 본인 availability; worker-schedule 색상 | workers-panel, schedule-panel, worker-mobile-schedule | 초기화 → workers/worker_availability; 기존 WorkerWork 보조 상태도 회사 auxiliary에 보존 |
| 일정 `ScheduleEvent`, `WorkerSchedule` | worker-schedule.ts GET worker-schedule / POST assign; daily-work + sites + availability + A/S로 투영 | schedule-panel, worker-mobile-schedule | 일일작업/현장/availability 영구화; A/S 부분은 여전히 메모리. 별도 schedule 테이블을 중복 생성하지 않음 |
| 일일작업 `DailyWorkRecord`, `DailyWorkParticipant` | daily-work.repository/service; app.module DailyWorkController GET/POST/PUT; operational.controller 작업/시간 수정 | daily-work-panel, mobile-workspace, instructions-panel | 초기화 → daily_work/participants; 기존 삭제 API 없음 |
| 사용자재 `Material`, `MaterialUsage` | daily-work.repository catalog/usages, daily-work.service save/siteMaterials; GET daily-work/site-materials/:id | site-materials-panel, daily-work-panel | 별도 정규화 테이블은 다음 단계; 일일작업 일관성을 위해 catalog/usages를 companies.auxiliary에 같이 보존 |
| 자재 단가표/이력/수입작업/버전/즐겨찾기 `WorkPrice`, catalog snapshot | standard-work.repository, material-persistence, material-catalog/material-excel/universal-material-excel/standard-work controllers | material-management-panel, standard-work-panel, material-import-review | 이미 MATERIAL_STORAGE=postgres/sqlite 지원, memory 모드도 있음; 001 material_management 스키마와 독립 유지 |
| 구매·작업비·기타경비 `ExpenseRecord`, `ExpenseLineItem`, `WorkerSettlement` | expenses.repository records/lineItems/settlements; expenses.service; app.module ExpensesController GET/POST/PUT/DELETE expenses | expenses-panel, business-panels | 메모리 유지 |
| 수금 `PaymentReceived` | finance.repository received; finance.service; GET/POST/PUT/DELETE payments-received | finance-panels, sites-panel | 메모리 유지 |
| 미수금·원가·마진 `SiteFinance` | finance.service, dashboard.service에서 계약금액·수금·지출을 조합; GET sites/:id/finance, dashboard | finance-panels, business-panels | 계산 결과는 저장 데이터 아님; 입력 중 계약금액만 이번 단계 영구화 |
| 작업진행자 지급·배분 `WorkerPayment`, `WorkerPaymentAllocation` | finance.repository paid/allocated; finance.service pay/removePayment; worker-payments/settlements | finance-panels, workers-panel, operational-workspace | 메모리 유지 |
| 증빙·세금계산서 `SalesInvoice`, `PurchaseInvoice`, `WorkerInvoice` | invoices.repository sales/purchases/workers Map; invoices.service; app.module InvoicesController GET/PUT invoices | invoices-panel, expenses-panel | 메모리 유지 |
| 견적 `Quote` 및 로컬 `QuoteRecord`, 구획/내역 로컬 `SectionRecord`, `ItemRecord` | quotes.repository Map/sections/items; quotes.service; app.module QuotesController GET/POST/PUT/DELETE quotes, copy/convert | quotes-panel, quote-detail-view, quote-line-editor, quote-summary-editor | 메모리 유지. 현장 전환 시 생성된 현장만 영구저장 |
| 사진 `PhotoRecord`, 첨부 `StoredFile` | photo.repository/service; file-storage.ts TemporaryFileStorage; photos API; quote-assets; after-service attachments | photos-panel, daily-work-panel, after-service-panel, quote-company-editor | 메타데이터와 바이트 모두 메모리 유지 |
| 사진대지·준공·점검보고서 및 연결 | photo-report/completion-report/inspection-report services 및 *-storage.ts, inspection-report.repository; sites/:siteId/*-reports | photo-report-panel, completion-report-panel, inspection-report-panel | 메모리 유지 |
| A/S `AfterService` 등 | after-service.repository.ts 회사별 Map, after-service.ts GET/POST/PUT/DELETE after-service 및 사진·파일·작업·견적 연결 | after-service-panel, schedule-panel | 메모리 유지 |
| 작업지시·알림·읽음 상태 | work-instructions.ts MemoryInstructionRepository 회사별 Map; work-instructions API | instructions-panel, mobile-workspace | 메모리 유지 |
| 감사 이력 | audit.repository.ts 회사별 Map; audit.controller / audit-recorder / audited-repository | audit-panel | 메모리 유지; 이번 core 트랜잭션과 별도 저장이므로 DB 실패 시 감사/알림 등 메모리 부수효과까지 원자적이지 않음 |
| 실적신고 수동 입력 `PerformanceInput` (business-reports.ts 로컬 타입) | business-reports.ts records 회사별 Map; GET business-reports/performance, PUT performance/:id | business-panels | 메모리 유지 |
| 범용 Excel 업로드/열매핑 서식 `Format`, `Mapping` (universal-material-excel.ts 로컬 타입) | UniversalMaterialExcelService uploads/formats Map; POST material-prices/universal/inspect 및 :id/preview | universal-material-import | 메모리 유지; 승인된 자재 원장과는 별개 |
| 초기설정 체크·튜토리얼 진행 | initial-setup.ts InitialSetupStore, tutorial.ts MemoryTutorialRepository | onboarding, tutorial UI | 메모리 유지 |
| trial 세션·제한·회사 설정·전체 업무 복제 | trial.ts, CompanyContext, companyRepository partition | 체험하기 및 모든 데모 화면 | 의도적으로 메모리 유지; 종료/만료/재시작 시 소실 |

실제 설치 환경에서 자재 저장 모드나 기존 DB 적용 여부는 이 코드 조사만으로 확정할 수 없다.
사진·경비·금융·견적·A/S·실적신고·범용 Excel 서식이 남아 있으므로 이번 변경은 앱 전체 영구저장 완료가 아니다.

## 구조와 권한

`UI/API → 기존 service → 기존 repository 계약 → CorePersistence → PostgreSQL`.
동기 service 계약을 보존하기 위해 요청마다 회사 행을 FOR UPDATE 잠근 뒤 4개 핵심 저장소를
복원한다. 성공 시 변경 상태를 upsert하고 commit한다. 오류 시 rollback한다. 회사 행 잠금은
여러 API 인스턴스 간 lost update도 방지한다. 대규모 데이터에서는 전체 회사 상태 로딩을
행 단위 비동기 repository로 바꾸는 후속 작업이 필요하다.

`app_core`는 기존 001 및 public.app_memberships와 충돌하지 않는 별도 스키마다.
회사 등록 시 기존 멤버십의 company_id만 새 companies에 추가한다. 기존 멤버십의 역할·승인·로그인
구조와 002~005 함수/정책/트리거를 변경하지 않는다. 기존 멤버십 worker_id/site_ids에는
유효하지 않은 과거 샘플 ID가 있을 수 있어 이번에 강제 FK를 추가하지 않는다. 로그인 때 회사와
작업진행자 연결을 검증하고, 업무 트랜잭션에서도 실제 승인/잠금/역할/권한을 DB에서 재확인한다.

신규 업무 행은 회사 FK, 현장/관리자/거래처/참여자는 `(company_id,id)` 복합 FK를 사용한다.
부모 삭제는 RESTRICT. 고객·현장·진행자 소프트 삭제를 유지하고 제거된 참여자도 deleted_at로 보존한다.
모든 신규 테이블에 created_at/updated_at와 업데이트 트리거, 회사·관계·날짜 인덱스를 둔다.
`trial_*`는 회사 CHECK 및 서버 검증으로 DB 진입을 차단한다.

서버는 비공개 CORE_DATABASE_URL로 연결한다. public/service role key를 프론트에 추가하지 않는다.
이 연결은 RLS 우회 가능한 서버 전용 역할을 전제로 하므로, API 회사 문맥·회사 조건·복합 FK·기존
PermissionService의 배정 확인과 민감 필드 제거가 필수 보안 경계다. 직접 브라우저 DB 접근은
RLS로 별도 차단한다. 활성 승인 admin만 소속 회사 조회/추가/수정; 회사 생성은 운영자만;
staff는 writeQuotes 권한이 있을 때 거래처 직접 조회만; worker는 본인 근무가능일 직접 조회만 허용한다.
현장 원본 JSON 및 회사 auxiliary에는 재무정보가 있으므로 staff/worker의 직접 SELECT는 허용하지 않는다.
직원/작업진행자 업무 화면은 기존 API의 권한 검사·현장 배정 확인·민감정보 제거를 통해 제공한다. 작업진행자 일정은 membership.site_ids에 별도로 들어 있지 않아도 실제 배정 관계로 확인하며, 타인의 일정은 필터링한다.
어떤 authenticated 사용자에게도 업무 DELETE 권한을 주지 않는다. 기존 승인 정책은 이번에 확장하지 않는다.

## 운영자가 직접 수행할 순서

1. 운영 중 메모리에 필요한 데이터가 있다면 **재시작/배포 전에** 현재 회사별 데이터를 내보내 보관한다.
   현재 DB 모드로 바꾸면 기존 메모리가 자동 복사되지 않는다. 회사정보도 기존 프로필을 별도로 백업한다.
   자동 import/초기화 코드는 넣지 않았다. 자료가 있다면 검증된 별도 이관 작업이 먼저 필요하다.
2. Supabase SQL Editor에서 002~005 적용을 확인하고 **006-core-business.sql 전체**를 직접 실행한다.
   앱·테스트가 운영 Supabase SQL을 실행하는 경로는 없다. 테스트는 임시 로컬 PGlite만 사용한다.
3. 새 회사가 기존 memberships에 없으면 006 하단의 명시적 회사 INSERT 예시로 실제 ID/프로필을
   등록한다. 기존 회사의 관리자·worker·site 연결은 샘플 ID 대신 영구 데이터 ID로 확인한다.
4. 기존 Render 서비스의 비밀 환경변수에 `CORE_DATABASE_URL`을 Supabase PostgreSQL의 TLS 연결
   URL로 설정하고 `CORE_STORAGE=postgres`를 지정한다. 새 Render 서비스를 만들지 않는다.
   기존 SUPABASE_URL/PUBLISHABLE_KEY/AUTH 설정 및 MATERIAL_STORAGE는 유지한다.
5. 재시작 후 로그인·승인·회사 프로필·현장·일정·일일작업을 확인하고 다른 회사 및 worker로 접근
   범위를 확인한다. 006 미적용/연결 오류는 startup 실패 또는 요청 오류이며 메모리로 fallback하지 않는다.

SQL 적용 전 호환성을 위해 **기본 CORE_STORAGE=memory**를 유지한다. 운영에서는 memory 경고를
출력한다. 이것은 임시 전환 모드이며 영구저장을 활성화한 상태가 아니다. postgres 전환은 위 절차 후에만 한다.
기존 process-memory 데이터가 있다면 배포도 재시작을 유발할 수 있으므로 백업 선행이 필요하다.

## 검증 기록

- `npm run typecheck`: 통과 (공유 타입/API/웹).
- `npm run build`: 통과 (공유 타입/API/Next.js 프로덕션 빌드). 화면 소스 변경 없음.
- `npm test`: 108개 통과, 실패/건너뛰기 없음. 신규 DB 테스트 3개가 전체 실행에 포함됨.
- 신규 테스트: 002~006 실제 SQL과 006 재실행, API 거래처/현장/진행자 CRUD 및 소프트 삭제,
  일정 배정/조회/변경, 일일작업 등록/조회/변경, 참여자 제거 이력, 회사 프로필/availability 보존,
  디스크 DB 재오픈 및 API 재시작, 타사 CRUD/복합 FK 차단, flush 중 FK 실패 rollback, trial 격리,
  worker 배정과 민감정보 차단, 잠금 즉시 반영, RLS/DELETE 금지, DB 장애 fallback 금지,
  Supabase 모의 공급자 세션+DB를 함께 사용하는 로그인·승인 화면·영구 worker 연결을 검증함.
- 기존 인증 회귀: 이메일/Google PKCE, 가입/승인, 세션 갱신, 잠금, 관리자 유지, 체험 격리 포함.
- 일정/일일작업 자체 DELETE는 기존 API에 없으므로 새 삭제 API는 추가하지 않음.
- 실 Supabase 마이그레이션과 접속 테스트는 실행하지 않음. 모든 DB 검증은 임시 로컬 PostgreSQL 호환 PGlite.
- 기존 서비스 health 접근은 클라우드 프록시 CONNECT 403으로 차단되어 Render 배포 성공 여부를 확인할 수 없음.
  Render 설정 변경/서비스 생성은 수행하지 않음.

## Render DB 초기화 진단

`onModuleInit`은 먼저 `SELECT 1`로 연결을 확인한 후 7개 테이블에 SELECT/LIMIT 0만 실행한다.
실패 시 `CORE_DB_INIT_FAILED code=... stage=... table=... message=...`를 기록하며 초기화를 중단한다.
`stage=connection table=none`은 로그인/네트워크/TLS 단계, `stage=schema/table probe`는
연결 성공 후 스키마·테이블 확인 단계다. 실패한 테이블에서 즉시 멈춘다. SQL 자동 생성/실행이나
메모리 fallback은 추가하지 않았다.

원본 Error 객체, stack, cause, detail, hint는 로그에 전달하지 않는다. 알려진 PostgreSQL·pooler·
네트워크·TLS 오류만 식별 가능한 고정 문구로 출력하며, 사용자명/호스트/주소 등은 제거한다.
미등록 오류는 code와 `unrecognized database error (raw message withheld for security)`로 표시한다.
이 경우 원문 전체나 접속 URL을 공유하지 말고 우선 안전한 code/stage/table로 추가 진단한다.

설치된 pg 8.23.x/pg-connection-string 2.x는 기본적으로 sslmode=prefer/require/verify-ca를
verify-full의 별칭으로 처리한다. CORE_DATABASE_URL에 이러한 모드가 있고 uselibpqcompat=true가
명시되지 않았다면 코드 내부에서 verify-full로 정규화한다. 현재 인증서 체인/호스트 검증 수준을
유지하면서 향후 버전 의미 변경 경고를 피한다. 나머지 명시적 옵션과 CA 설정은 유지한다.
인증서 검증을 끄는 옵션은 추가하지 않는다. Render 환경변수 자체는 변경하지 않는다.

운영자는 기존 Render 서비스가 새 커밋으로 배포됐는지 먼저 확인하고, 유지 중인 memory 모드에서
서비스 기동을 확인한 다음 CORE_STORAGE=postgres로 변경하여 재배포한다. 실패하면 Render Logs에서
CORE_DB_INIT_FAILED 한 줄을 확인한다. 이 진단 변경을 위해 006을 재실행하거나 새 SQL을 실행할 필요는 없다.
필요 시 CORE_STORAGE=memory로 복귀할 수 있으며 DB 데이터는 삭제/초기화하지 않는다.

진단 변경 검증: typecheck/build 통과, 전체 테스트 113개 통과(실패·건너뛰기 0).
초기화 순서/중단 단계/비밀값 비노출/SSL 별칭/memory 무접속 테스트 5개와 기존 DB·인증·memory 회귀를 포함한다.

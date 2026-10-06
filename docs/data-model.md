# 데이터모델 초안

현재 PostgreSQL은 사용하지 않습니다. 아래는 이후 설계를 위한 제안이며 SQL 스키마나 마이그레이션이 아닙니다.

| 엔터티 | 주요 필드 | 관계 |
| --- | --- | --- |
| Site 현장 | id, name, address, status, scheduledDate | 여러 견적·작업·경비·수금 |
| Worker 작업진행자 | id, name, contact, active | 여러 현장 배정 |
| SiteAssignment 현장배정 | siteId, workerId, startDate, endDate | 현장과 작업진행자의 다대다 연결 |
| Estimate 견적 | id, siteId, revision, status, totalAmount | 여러 견적 항목 |
| EstimateItem 견적항목 | estimateId, description, quantity, unitPrice | 견적에 종속 |
| Contract 계약 | id, siteId, amount, signedDate | 현장 계약 및 변경 계약 |
| DailyWork 일일작업 | id, siteId, workerId, workDate, description | 작업일 및 현장 |
| Expense 자재·경비 | id, siteId, category, amount, incurredDate | 현장별 비용 |
| Collection 수금 | id, contractId, amount, receivedDate | 계약 수금 원장 |
| WorkerPayable 지급의무 | id, workerId, siteId, amount, dueDate | 작업진행자 지급 예정 |
| WorkerPayment 지급 | id, payableId, amount, paidDate | 지급 원장 |
| Attachment 첨부 | id, siteId, storageKey, filename, mimeType | NAS를 추상화한 파일 참조 |
| User 사용자 | id, role, workerId | 인증 단계에서 추가 |

금액은 PostgreSQL BIGINT(원 단위) 또는 NUMERIC으로 저장하고 소수점 반올림 규칙을 명시해야 합니다. API 숫자가 JavaScript 안전 정수 범위를 넘는 경우 문자열 계약으로 전환합니다. 업무일은 DATE, 생성/변경 시각은 TIMESTAMPTZ를 사용하고 서울 시간으로 표시합니다.

현재 API의 `SiteInput`은 현장 기본정보 입력 계약이며 `Site`는 ID와 실제 메모리 수금/지급 원장 누계가 포함된 조회 계약입니다. `client`, `contactName`, `phone`, `description`, `startDate`, `endDate`를 제공하고 종료예정일 미정은 빈 문자열, 대표 작업진행자 미배정은 null로 표현합니다. `contractAmount`는 현장 계약 입력값이고 `collectedAmount`, `unpaidWorkerAmount`는 현재 금융 원장에서 집계할 읽기 모델이며 위 테이블 전체를 대신하지 않습니다. 로그인/권한 및 파일 접근 정책은 별도 설계가 필요합니다.

## 작업진행자 초기 계약

Worker는 `name`과 `displayName`을 분리하며 `phone`, 업무 `role`, `memo`, `defaultAvailability`, `deletedAt`을 보관합니다. 시스템 권한은 Worker의 role/displayName으로 판단하지 않고 이후 User/Role 모델로 관리합니다.

WorkerAvailability는 workerId+date 기준 유일한 상태(근무가능/휴무/오전불가/오후불가)이며 기본 상태보다 우선합니다. 이전 WorkerWork 샘플은 현재 지급예정액/미지급액에 사용하지 않습니다. 지출과 지급 원장이 금융 집계의 기준입니다.

Site의 managerId는 작업진행자를 참조하고 manager는 배정 당시 표시명 스냅샷입니다. Worker 삭제는 soft delete로 구현하고 물리 삭제/연쇄 삭제를 하지 않습니다. 기존 참조와 표시명은 보존하며 활성 선택 목록에서는 제외합니다. 과거 참여는 작업기록의 siteId와 현재 대표 배정을 합쳐 조회합니다.

## 일일작업 관계형 이전 경계

- `daily_work`: id(PK), work_date(DATE), site_id(FK), manager_id(FK), site_name_snapshot, manager_display_name_snapshot, start_time(TIME, nullable), end_time(TIME, nullable), content, notes, status. before_photo_count/after_photo_count는 photo_records에서 집계합니다. material_count는 사용내역 행 수로 집계하는 조회값입니다.
- `daily_work_participants`: daily_work_id(FK), worker_id(FK), display_name_snapshot. (daily_work_id, worker_id) 복합 PK/유일 제약.

메모리 어댑터도 두 컬렉션을 분리합니다. 저장소 save는 기본기록과 참여관계 교체를 한 작업으로 수행하며 PostgreSQL 전환 시 트랜잭션으로 처리해야 합니다. site_id+work_date에는 유일 제약을 걸지 않아 동일 현장의 여러 날짜/여러 기록을 허용합니다. 작업진행자는 soft delete하고 FK를 연쇄 삭제하지 않습니다. 조회용 스냅샷은 명칭 변경 후에도 보존됩니다.

작업시간은 당일 HH:mm 차이의 분 단위 파생 값이며 저장하지 않습니다. 미정은 API에서 빈 문자열/totalMinutes null로 표시합니다. 향후 DB에서는 TIME null로 매핑합니다. 야간 작업은 날짜별로 분리합니다. 사진 건수는 photo_records에서 집계하는 읽기 필드입니다. 사용자재 건수는 현재 연결된 사용내역 행 수로 집계합니다.

## 사용자재와 구매 분리

- `materials`: id, name, specification, unit. 자재명+규격+단위로 현재 카탈로그를 재사용합니다. 가격은 저장하지 않습니다. 이름·규격·단위 변경은 새 카탈로그 항목으로 연결해 기존 항목을 보존합니다.
- `daily_work_material_usage`: id, daily_work_id(FK), material_id(FK), name_snapshot, specification_snapshot, unit_snapshot, quantity(NUMERIC, 소수점 3자리), notes.

사용내역의 현장/작업일자는 daily_work.site_id/work_date에서 조인하므로 중복 저장하지 않습니다. 일일작업 수정 시 작업·참여자·사용내역을 한 트랜잭션으로 반영해야 합니다. 사용 행은 독립 ID를 가지며 같은 자재를 같은 작업에 여러 줄 입력할 수도 있습니다. 기록 건수는 행 개수이고 현장 합계는 이름/규격/단위의 합입니다. 자재명은 외부 가격표나 비용과 연결되지 않습니다.

후속 구매는 `material_purchases` 및 구매 항목을 별도 테이블로 설계하고 material_id를 참조합니다. 회사 직접구매/작업진행자 대납, 가격, 영수증, 현장원가 배분은 구매 및 원가 도메인에서 관리합니다. 구매량과 실제 사용량은 별개이며 지출 원장에 구매금액을 기록하지만 자동 원가 배분이나 구매 차감은 하지 않습니다. 반환/재고 이동은 별도 후속 정책이 필요합니다.

## 사진 엔터티와 파일 저장소

`photo_records`: id(PK), daily_work_id(FK), type(작업 전/작업 후), location, description, captured_at(TIMESTAMPTZ nullable), uploaded_by, sort_order, original_filename, storage_key, mime_type, size, created_at, is_sample. 현장 ID와 작업일자는 daily_work에서 조인합니다. 조회 계약 PhotoView는 siteId/workDate/url을 포함합니다. 원본 파일은 독립 FileStorage 어댑터에서 storage_key로 조회하며 DB에 원본 바이트를 저장하지 않습니다.

순서는 일일작업+사진 구분별로 관리하고 전체 ID 검증 후 교체합니다. 삭제 시 그룹 순서를 다시 번호 매깁니다. PostgreSQL 이전 시 순서 교체와 삭제는 트랜잭션으로 처리하고 FK 및 (daily_work_id, type, sort_order) 인덱스를 고려하세요. 클라우드/NAS 이전 시 파일과 메타데이터 저장 실패 보상도 어댑터에서 처리해야 합니다.

현재 임시 어댑터는 원본 바이트를 그대로 보관하며 삭제하면 제거합니다. 장기 원본 보존 정책은 별도 결정이 필요합니다. 스마트폰 촬영·EXIF는 입력 어댑터, 사진대지 PDF는 정렬/위치/촬영시각/원본을 사용하는 별도 서비스로 확장합니다. 관리자 승인 시 uploaded_by를 인증 사용자 FK로 전환하고 approval_status/reviewer_id/approved_at 등을 추가할 수 있습니다. 필수사진 수는 작업완료 검증 정책으로 추가합니다. 이번 단계에는 승인·자동 검사·PDF 생성이 없습니다.


## 구매·지출과 작업진행자 지급 관계

현재 `ExpensesRepository`는 다음 컬렉션을 분리합니다.

- `expenses`: id(PK), expense_date(DATE), site_id(FK 필수), daily_work_id(FK nullable), site_name_snapshot, type, description, vendor, supply_amount, vat, payment_method, evidence_type, purchaser_snapshot, is_worker_advance, settled, settlement_date(DATE nullable), notes, receipt_file_key(nullable), created_at, updated_at.
- `expense_line_items`: expense_id(PK/FK), quantity(NUMERIC 소수점 3자리), unit. 현재 지출당 한 품목이며 이후 복수 구매 항목으로 확장할 수 있습니다. 구매유형만 `material_purchases` 뷰 또는 테이블로 분리할 수 있고 향후 material_id를 연결할 수 있습니다.
- `worker_settlements`: expense_id(PK/FK), worker_id(FK), display_name_snapshot. 작업비와 대납 지출의 지급 대상 관계이며 금액/정산 상태는 expense에서 조인합니다. 같은 지급의무를 별도 금액으로 복제하지 않습니다.

합계금액은 supply_amount+vat의 읽기 값입니다. PostgreSQL의 BIGINT/NUMERIC 및 JS 안전 정수 정책을 적용해야 합니다. 현재 수량은 단가 곱셈에 쓰지 않고 전체 공급가액을 입력합니다. 현재 worker_payments와 지출별 배분으로 전액/일부 지급을 지원합니다. DB 이전 시 아래 트랜잭션 정책이 필요합니다.

daily_work_id가 있으면 expenses.site_id와 같은 현장이어야 합니다. 현장 변경 시 기존 지출 연결을 먼저 해제하도록 검증합니다. DB에서는 복합 FK 또는 트랜잭션 검증을 고려하세요. 생성/수정 시 지출·항목·지급 관계를 트랜잭션으로 저장하고 삭제 시 해당 종속 관계만 제거합니다. 작업진행자 FK는 soft delete 후에도 보존하고 신규 배정에서 제외합니다.

사용자재 daily_work_material_usage와 지출/구매는 별도 기록입니다. 구매량=사용량으로 가정하지 않으며 재고 차감/원가 배분을 수행하지 않습니다. receipt_file_key는 향후 영수증 저장소 참조이고 현재 파일을 업로드하거나 연결의 유효성을 검증하지 않습니다. 세금계산서/결제/파일 연동은 별도 어댑터로 추가합니다.


## 수금 원장과 지급 배분

- `payments_received`: id(PK), site_id(FK 필수), received_date(DATE), amount(BIGINT), method, payer, notes, created_at. 수금은 현장 계약과 연결하며 여러 건 허용합니다. 음수/0원/소수 입력을 거부하고 초과 입금은 음수 미수로 표시합니다.
- `settlement_items`: 현재 expenses+worker_settlements에서 조인하는 지급의무 읽기 모델입니다. id=expense_id, site_id, worker_id, category(작업비/자재대납/기타정산), expense_date, amount. 금액을 별도 원장에 복제하지 않습니다.
- `worker_payments`: id(PK), site_id(FK), worker_id(FK), payment_date(DATE), amount(BIGINT), notes, created_at. 한 지급은 한 현장/작업진행자에만 속합니다.
- `worker_payment_allocations`: payment_id(FK), expense_id(FK), amount(BIGINT). 지급액을 정산 항목별 잔액에 배분하며 지급 헤더 금액=배분 합계입니다.

현재 메모리 저장소는 지급 헤더와 배분을 동기적으로 한 호출에 저장/취소합니다. PostgreSQL에서는 지급 시 동일 현장/작업진행자의 미지급 항목을 잠그고 잔액 검증→배분→헤더/배분 저장을 한 트랜잭션으로 수행해야 합니다. 전액 재요청은 잔액 0이면 거부합니다. 실제 결제 연결 시 별도 idempotency_key 및 승인/취소 감사 원장을 추가해야 합니다. 현재 지급 기록 삭제는 원장 수정이며 실제 송금 취소가 아닙니다.

지출 수정/삭제도 관련 지급 관계를 같은 트랜잭션에서 검사해야 합니다. 지급이 남은 항목의 현장/작업진행자/유형 변경과 지급액 미만 축소를 막고 지출일은 지급일을 넘을 수 없습니다. 비용을 수정하려면 지급 기록을 먼저 취소합니다. worker_payments의 worker FK는 soft delete 후 보존합니다. 회사 지출의 settled는 기록 상태이고 작업진행자 지출의 settled/paidAmount/payoutStatus는 지급 배분 합계에서 계산합니다.

FinanceService가 현장/대시보드/작업진행자의 공통 집계 경계입니다. 미수=계약−수금, 현장차익=계약−지출, 미지급=지급의무−배분액입니다. 월 발생 지급예정액은 expense_date, 월 지급액은 payment_date 기준이고 월 발생분 잔액은 해당 월 지출의 현재 잔액입니다. 현장차익에는 지급 원장을 비용으로 다시 더하지 않습니다. 세금·보험·고정비 및 회계상 순이익 처리는 별도 회계 도메인입니다.

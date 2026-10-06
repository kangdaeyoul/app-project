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

현재 API의 `Site`는 대시보드 샘플 조회 DTO입니다. `contractAmount`, `collectedAmount`, `unpaidWorkerAmount`는 미래 원장에서 집계할 읽기 모델이며 위 테이블 전체를 대신하지 않습니다. 로그인/권한 및 파일 접근 정책은 별도 설계가 필요합니다.

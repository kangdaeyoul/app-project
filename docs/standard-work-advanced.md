# 표준작업 세트 고도화

기존 16개 전기/기계 세트를 유지합니다. 견적 빠른입력은 품목/표준작업 탭으로 구분하며 작업명 버튼을 클릭하면 기본수량으로 즉시 구성품을 추가합니다. 설정 버튼에서 수량/배선·배관 길이/작업구분/노출·매립/기존 배선·배관·기구 활용/천장/층고/야간/철거를 선택한 후 추가할 수 있습니다. 직접입력 구성품은 항목별 수량을 입력해야 합니다.

`표준작업 구성품 · 자재단가`에서 작업세트를 추가, 복사, 수정, 삭제하고 활성 여부와 기본수량/단위/공종/설명/작업구분을 관리합니다. 전체 세트는 구성품별 계산을 합성하며 구성품마다 작업수량 비례/고정/길이/1식/직접입력을 선택합니다. 구성품 추가·삭제 및 위/아래 순서 변경을 지원합니다. 세트·구성품 적용조건 변경은 새 버전 저장 후 계산에 반영됩니다. 관리 화면에서 비활성 세트도 편집할 수 있으나 빠른입력 목록에서는 제외하고 계산 API도 거절합니다.

조건은 key/operator/value 구조입니다. 지원 키: workType, installation, reuseWiring, reusePiping, reuseEquipment, ceiling, height, night, demolition. 세트 conditions와 구성품 includeWhen은 모든 조건이 일치해야 합니다. excludeWhen은 하나라도 일치하면 제외합니다. height는 숫자 비교(같음/다름/이상/이하), 나머지는 문자열/불리언 같음·다름을 지원합니다. 기본 조건은 노출, 재사용 없음, 일반 천장, 층고 3m, 주간, 철거 포함이며 작업구분은 해당 세트 설정에서 가져옵니다. 조건을 생략한 기존 API 호출도 동작합니다.

현장 재사용 플래그는 각각 전선/배선, 전선관/배관, 주자재를 제외하며 철거 포함 OFF는 철거노무를 제외합니다. 기존 omitWhen 재사용 조건도 함께 지원합니다. 천장/층고/야간/노출·매립은 관리자가 구성품 조건으로 지정할 수 있습니다. 별도 조건을 지정하지 않은 일반 구성품은 조건을 바꾸어도 수량이 변하지 않습니다. 규칙 충족 시 포함/제외만 적용하며 현장 난이도에 따른 수량 보정은 관리자 기준수량이나 직접입력으로 처리합니다.

자재DB의 현재 판매단가를 계산할 때마다 조회합니다. 요청 autoPrice 또는 회사 기본값으로 자동단가를 결정합니다. OFF에서는 금액을 내부적으로 0과 pricePending 플래그로 저장하고 견적 단가 입력란을 비워 표시합니다. 사용자가 단가를 입력하면 플래그를 해제합니다. 자동 추가와 수동 입력은 기존 공통 합산 함수에 연결되므로 기존 행의 수정단가와 가격 미입력 상태를 자동으로 덮어쓰지 않습니다. 기본값과 노무계수는 실제 검증된 기준이 아닌 수정 가능한 샘플입니다.

내부 세부 구성품/원가는 유지합니다. 고객 묶음 옵션은 잡자재, 부속류, 배관 및 부속, 배선 및 부속, 설치 및 결선비 등을 1식으로 합산할 수 있습니다. 같은 공종·고객금액분류·묶음명 기준으로 합산하며 내부 원가/마진/출처/미입력 플래그는 고객 DTO와 PDF/Excel에 넣지 않습니다.

추가 API: POST `/standard-work` 생성, POST `/standard-work/:id/copy` 복사, DELETE `/standard-work/:id` 삭제. PUT 변경은 기존 version 비교로 충돌을 검출합니다. 삭제는 deletedAt 및 비활성 상태의 새 버전을 남기고 일반 목록에서 제외합니다. 과거 버전과 기존 견적의 단가·출처는 유지하며 삭제 후에도 관리자 버전이력 조회가 가능합니다. 회사 관리자 권한과 회사별 저장소 분리를 유지합니다.

PostgreSQL 이전 시 standard_work_templates(company_id,id,work_type,section,active,deleted_at), standard_work_template_items(company_id,template_id,version,component_id,price_id,position,role,mode,factor,length_key,customer_group), standard_work_conditions(company_id,template_id,version,component_id nullable,scope,key,operator,typed_value,position), standard_work_versions(company_id,template_id,version,changed_by,changed_at,reason,snapshot)을 사용합니다. 복합 회사 FK, 버전 유일키, 원자적 버전 저장과 자재 단가 스냅샷이 필요합니다. 현재는 회사별 메모리 어댑터를 유지합니다.

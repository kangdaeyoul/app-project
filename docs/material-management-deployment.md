# 자재단가 관리와 안전한 배포

## 현재 분석 결과 (2026-10-12, 한국 기준)

- 저장소: `kangdaeyoul/app-project`, 로컬 `work`, 원격 `main`. 분석 기준 HEAD `94aac7f`.
- Next.js 16 / React / TypeScript 관리자 웹, NestJS / TypeScript API, 공통 타입 패키지.
- 기존 자재는 `MemoryStandardWorkRepository`의 회사별 배열, 업로드는 Map, 이력은 배열에 저장된다. 코드의 `PRICE-*`와 표준작업 기본 자재는 샘플이다. 실행 중 관리자가 수정한 자료는 실제 입력일 수 있으므로 샘플 ID를 이유로 삭제하지 않는다.
- 기존 `/imports/preview`는 운영 단가를 변경하지 않는다. `/apply`가 운영 자료에 반영한다. 기존 UI에는 셀 편집·검토 저장·승인 대기·승인 확인창이 없었다.
- 실제 PostgreSQL 연결이나 Render DB 접속 설정은 이 작업 환경에 없었다. `render.yaml`은 Docker 단일 웹 서비스 설정이다. 실제 Render 서비스의 GitHub 연결, 자동 배포 설정, 배포 성공 여부는 파일만으로 확인할 수 없다.
- 공개 주소: `https://app-project-7wyo.onrender.com/`. 클라우드 HTTP 접근은 403 정책 차단. 네트워크 허용 초안은 저장했으나 적용되지 않았다. Render 관리 API 인증도 없어 자동 배포 상태는 미확인.
- 인증은 기존 서버 메모리 사용자/세션, 회사별 멤버십, 역할, 추가 권한 체계를 유지한다. 본 작업의 영구화 대상은 자재·검토·가격 이력·표준작업 버전·즐겨찾기이며 현장·견적·인증 등 다른 저장소까지 영구화한 것은 아니다.

## 저장 방식

`MaterialPersistence`는 기존 동기 저장소 인터페이스를 유지하면서 요청마다 회사에 귀속된 트랜잭션을 연다. 승인 시 자료 재검증, 충돌 검사, 자재 갱신, 이력 기록, 업로드 완료 상태 저장을 하나의 트랜잭션으로 처리한다. DB 설정 후 연결 실패 시 메모리로 자동 전환하지 않는다.

- `memory`: 기존 테스트와 호환. 영구 저장이 아니며 운영 자재관리에는 사용하지 않는다.
- `sqlite`: Node 24의 내장 SQLite. WAL, busy timeout, 단일 API 프로세스 직렬화. `mm_catalogs`에 회사별 버전 있는 JSON 문서를 원자적으로 저장. 로컬 미리보기 기본값은 저장소의 `.local/materials.sqlite`. 단일 API에 적합하다. 여러 서버 복제본에는 PostgreSQL을 사용한다.
- `postgres`: `pg` 연결 풀. 회사별 `catalogs` 행 잠금으로 여러 API 인스턴스의 동시 갱신을 직렬화한다. 자재·가격이력·검토 작업을 별도 테이블에 저장하며 회사+ID 복합키 및 회사+자재코드 고유키로 분리한다. 표준작업 버전과 즐겨찾기는 회사 설정 JSONB에 보존한다.

PostgreSQL 테이블: `material_management.catalogs`, `materials`, `price_history`, `import_jobs`. 기존 테이블은 변경하거나 삭제하지 않는다. 스키마 생성은 API 시작 때 자동 실행하지 않는다.

### 환경변수

| 이름 | 용도 |
| --- | --- |
| `MATERIAL_STORAGE` | `postgres` 권장, 로컬 `sqlite`, 기존 회귀 테스트 `memory` |
| `MATERIAL_DATABASE_URL` | PostgreSQL 연결 URL. Render의 Environment에서 비밀값으로 입력. GitHub나 채팅에 기록하지 않는다. |
| `MATERIAL_DB_SSL` | 외부 DB 연결은 `true`. TLS 인증서 검증을 끄지 않는다. Render 내부 연결은 해당 DB의 지침에 따라 설정. |
| `MATERIAL_SQLITE_PATH` | 로컬 `.local/materials.sqlite`. Render SQLite 선택 시 반드시 영구 디스크 안의 경로. |
| `MATERIAL_SEED_SAMPLES` | 새 빈 회사에만 샘플 초기 등록. 운영 `false`. 기존 자재를 덮어쓰지 않는다. |
| `DEMO_LOGIN_ENABLED` | 기존 데모 인증 설정을 유지. 운영 실제 인증은 별도 필요. |
| `AUTH_SECURE_COOKIE` | 공개 HTTPS `true`, 로컬 HTTP `false` |

저장소 모드나 DB 주소를 바꾸면 이전 메모리 자료가 자동으로 이전되지 않는다. 반드시 아래 백업·병합을 먼저 준비한다.

## Render에서 PostgreSQL 준비

1. 현재 서비스의 Settings에서 GitHub 저장소, 배포 브랜치, 빌드 방식, Auto-Deploy 설정을 기록한다. 기존 배포 설정을 임의 변경하지 않는다.
2. 현재 운영 자재를 현재 자재목록 Excel로 다운로드한다. 새 버전의 백업 다운로드는 이력·검토·표준작업 버전을 포함한 회사별 JSON을 제공한다. 구버전은 이 전체 백업 API가 없으므로 조회 가능한 자료와 작업 중 업로드 파일을 따로 보관한다.
3. Render Dashboard에서 PostgreSQL을 생성하거나 기존 PostgreSQL을 재사용한다. 데이터 보존·백업·보존기간을 확인할 수 있는 운영 플랜을 선택한다. 서비스와 같은 지역의 DB가 권장된다.
4. 사용자 승인 후 새 DB의 연결값을 서비스 Environment에 입력한다. `MATERIAL_STORAGE=postgres`, `MATERIAL_SEED_SAMPLES=false`를 설정한다. 기존 PORT·쿠키·로그인 설정은 유지한다.
5. DB 스냅샷 또는 `pg_dump` 백업 후, 승인된 접속 환경의 프로젝트 루트에서 `npm run materials:migrate -w @jongro/api`를 실행한다. 이 명령은 전용 스키마와 테이블을 추가할 뿐 기존 테이블이나 운영 행을 지우지 않는다.
6. 승인 후 기존 JSON 자료는 `npm run materials:import-backup -w @jongro/api -- <백업 파일 경로>`로 병합한다. 고유 ID/코드/버전이 충돌하면 전체 롤백하며 기존값을 덮어쓰지 않는다. 가격 갱신은 UI의 Excel 검토·승인으로 처리한다. 비밀 접속값은 환경변수로만 전달한다.
7. GitHub 푸시와 배포 승인을 받은 뒤 기존 서비스에 배포한다. 필요 시 안전한 점검 시간과 기존 버전 복구 절차를 먼저 정한다. 이 문서나 예시 Blueprint만으로 서비스나 DB가 생성되지 않는다.
8. 자재관리 상단이 `영구 PostgreSQL`인지, 승인된 자료가 보이는지, 로그인·견적·현장·Excel 출력이 동작하는지 확인한다. 실제 DB 스냅샷을 다시 보관한다.
9. 서비스 재시작 및 재배포 후 같은 자재·검토·이력 조회를 확인한다. 다른 PC에서도 같은 회사 계정으로 동일 자료를 조회한다.

`deploy/render-materials.example.yaml`은 새 프로젝트용 구성 예시이며 현재 `render.yaml`을 대체하지 않는다. 검토 없이 Blueprint를 적용하지 않는다. 실제 자동 배포 상태는 Render Settings에서 확인해야 한다. 자동 배포가 켜져 있다면 GitHub 푸시 자체가 운영 배포를 유발할 수 있으므로 이번 작업에서는 푸시하지 않는다.

### SQLite를 Render에서 선택할 때

무료/임시 파일시스템에 SQLite를 두면 재배포 후 자료가 사라진다. Render Persistent Disk를 사용하는 단일 인스턴스 서비스에서만 선택하고, DB 경로의 쓰기 권한과 디스크 백업을 확인한다. 디스크 없는 운영 서비스에는 PostgreSQL을 사용한다. 디스크는 기존 서비스 설정 변경이므로 별도 승인 후 적용한다.

## 가격과 Excel 규칙

- 다운로드와 업로드는 공통 `MATERIAL_EXCEL_COLUMNS`의 13개 열을 사용한다. 쉼표 숫자, 실제 숫자, Excel 날짜를 읽는다. 암호/손상/구형 XLS 안내를 구분한다. 수식은 값으로 바꿔 다시 입력한다.
- 최근매입가·기준원가·판매단가는 독립된 필드이다. 최근매입가를 기준원가로 대체하지 않는다.
- 기존 견적 계산 타입과 호환하려고 미입력 가격의 숫자 슬롯은 0을 유지하되 등록 여부 플래그로 구분한다. UI·Excel에는 미입력/빈 셀로 표시하고 단가 미등록 상태를 전달한다. 미입력과 실제 등록된 0원은 다르다.
- 판매가격 방식은 직접입력/원가가산/소매가격이다. 원가가산은 명시적으로 선택할 때만 사용하며 기본 가산율 30%를 수정할 수 있다. 소매가격은 입력 금액을 유지한다.
- 원가 VAT와 판매 VAT를 구분한다. VAT 포함 DB 가격은 새 견적에 공급가 단가로 변환한 뒤 견적 총괄에서 VAT를 한 번 적용한다. 기존 저장 견적을 재계산하지 않는다.
- 표준 Excel의 단일 VAT 열은 공통 기준이다. 기존 품목에 서로 다른 VAT 기준이 있고 공통 기준을 변경하지 않으면 개별 VAT 설정을 보존한다.
- 같은 코드지만 품명·규격·단위가 다른 행은 승인 전에 명시적인 갱신/신규 고유코드/제외/보류 선택이 필요하다.
- 검토 저장은 업로드 작업만 변경하며 운영 자재는 변경하지 않는다. 오류행은 수정하거나 제외한 후 전체 승인, 또는 정상행만 승인할 수 있다. 완료·취소 작업은 재편집할 수 없다.
- 자재 비활성화는 과거 견적·이력을 삭제하지 않는다. 새로운 빠른입력 목록에서는 제외한다.

## 권한

관리자: 전체 자재관리, 최종 승인, 백업. 사내직원: 회사 자재 조회, 내부원가 조회는 기존 권한 적용. `manageMaterials`: 개별 자재 수정·업로드 검토. `approveMaterials`: 최종 승인. 일반 직원/작업진행자는 승인 API를 사용할 수 없다. 관리자 사용자 관리에서 추가 권한을 지정한다. API도 세션·회사·권한을 다시 검사한다.

## 백업 및 복구

- 회사별 JSON 백업은 자재/이력/검토/버전/즐겨찾기를 포함한다. 다운로드 파일은 내부 가격 자료이므로 사내 보호 위치에 저장한다. GitHub에 올리지 않는다.
- SQLite는 실행 중 파일 하나만 복사하면 WAL 누락이 생길 수 있다. 관리자 JSON 백업 또는 SQLite Backup API/안전한 종료 후 DB+WAL을 보존한다.
- PostgreSQL은 Render 백업과 `pg_dump`를 사용한다. 복구는 별도 DB에서 먼저 검증한다. 운영 DB 덮어쓰기·초기화·테이블 삭제는 수행하지 않는다.
- 이전 메모리 자료는 서버 종료 전에 반드시 백업한다. 이미 재시작으로 사라진 메모리 입력은 코드만으로 복원할 수 없다.

## 개발 검증의 운영 DB 보호

`npm test`는 테스트 전용 환경을 먼저 불러와 `MATERIAL_STORAGE=memory`로 설정하고 운영 접속값을 사용하지 않는다. 영구 저장 테스트는 별도의 임시 SQLite 파일과 PGlite PostgreSQL 엔진을 생성한다. Node.js 24 이상이 필요하다. 현재 Render Docker 이미지는 이미 Node 24를 사용하므로 런타임 변경은 없다.

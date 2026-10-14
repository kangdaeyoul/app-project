# 자재단가 관리 개선 검증 보고 (2026-10-12)

## 반영 상태

기존 프로젝트 소스 수정과 로컬 검증을 완료했다. GitHub main은 `94aac7f`이며 이번 변경은 아직 커밋·푸시하지 않았다. 요청 14항에 따라 승인 전에 GitHub 푸시, 운영 DB 변경, Render 배포를 실행하지 않았다. 자동 배포가 켜져 있다면 푸시만으로 운영 배포가 발생할 수 있다.

## 구현 기능

- 등록 자재관리 / 엑셀 업로드·검토 / 승인 대기 / 변경 이력의 4개 탭.
- 13개 표준 항목 직접 수정, 상세보기, 비활성/재활성, 이력 검색. stable ID와 변경 가능한 자재코드 분리. 개별 편집 충돌 방지.
- 업로드 분석, 모든 행 검토, 30행 페이지, 검색·규격·공종·미입력·중복·오류 필터, 셀 편집, 행 선택 제외, 고유 코드 신규등록, 기존 갱신, 보류.
- 검토 저장·이어가기·전체 취소·승인 요청·승인 대기·최종 승인 확인창. 서버 재검증과 원자적 반영. 전체 승인과 정상행만 승인.
- 최근매입가/기준원가/판매단가 분리, 쉼표 금액 인식, 미입력 플래그 및 빈 셀 내보내기, 직접/가산/소매 가격 방식, 기본 30% 가산율 수정, VAT 기준 분리.
- 필드별 변경 전후·수정자·승인자·시점·사유·변경방식 저장. 견적과 구매/지출의 저장 값은 자동 변경하지 않음.
- 회사별 SQLite 및 PostgreSQL 영구 저장 어댑터. PostgreSQL 전용 추가 스키마, 회사 행 잠금, rollback, 재시작 보존.
- 관리자 백업 다운로드, 충돌 없는 백업 병합 도구, 테스트가 운영 DB에 접속하지 않는 환경 보호.
- 기존 로그인·견적·표준작업·즐겨찾기·빠른입력·자재/경비 메뉴 유지. 일반 직원의 조회와 권한 담당자의 편집·승인 구분.

## 확인한 기존 문제와 해결

메모리 배열/Map을 다시 생성하므로 자재 가격과 검토 내역이 재시작 후 사라졌다. 선택 가능한 영구 저장 어댑터를 추가했다. 빈 가격은 기존 파서에서 숫자 0으로 처리했고 쉼표 문자열을 거부했다. 등록 여부 플래그로 미입력을 구분하고 숫자/숫자 문자열/쉼표 금액을 처리한다. 기존 미리보기는 운영 자재를 바꾸지 않았으나 셀 편집과 승인 대기 상태가 없었다. 검토와 승인 UI/API를 분리했다.

유효한 다운로드 XLSX를 실제로 업로드하고 복원하는 검증은 통과했다. 사용자가 실패했던 개별 파일은 제공되지 않아 그 파일의 실패 원인을 확정하지 않았다. 현재는 파일 읽기 오류와 13열 헤더 오류를 구분하며 MIME이나 확장자만으로 유효한 XLSX를 거부하지 않는다.

VAT 포함 단가를 공급가 단가로 변환해 새 견적의 VAT 이중 반영을 방지했다. 이를 검증하기 위해 기존 VAT 포함 가격 테스트의 기대값도 공급가 기준으로 갱신했다. 과거 저장 견적은 그대로 유지한다.

## 테스트 결과

| 검증 | 결과 / 근거 |
| --- | --- |
| 의존성 재설치 | Node 24.19, `npm ci --cache /workspace/.npm-cache` 성공 |
| 전체 프로젝트 빌드 | 성공 |
| TypeScript 검사 | 성공 |
| API/도메인 테스트 | 79개 성공, 실패 0, 건너뜀 0 |
| 원본 다운로드 표준 XLSX, 13열, 세 가격, 쉼표·날짜·빈 가격 | API 및 실제 브라우저 성공 |
| 업로드/검토만으로 운영 가격 불변, 셀 가격 수정 | API 및 PC 브라우저 성공 |
| 취소 후 운영 자료 유지, 중복코드 차단/고유코드 신규등록/행 제외 | API 및 PC 브라우저 성공 |
| 최종 승인, 변경 이력, 수동 수정, 조회 전용 직원 차단 | API 및 PC 브라우저 성공 |
| 수정권한 직원의 승인 호출 차단 | 실제 세션 API 403 확인 |
| 회사 데이터 격리, 과거 견적 수정단가 보존 | API 및 기존 견적 브라우저 회귀 성공 |
| 현재 목록 XLSX 내려받기/다시 업로드 | 신규 0·갱신 0·오류 0 확인 |
| 가격 가산·소매가격·VAT·세 가격 분리 | API/도메인 테스트 성공 |
| 대량 검토 | 240행, JSON 255,537바이트의 실제 HTTP 검토 저장 및 취소 성공, 운영 자재 미반영 |
| 실제 API/웹 프로세스 종료 및 재시작 | 브라우저 등록 가격 8,888원, 변경 자재코드, 이력 2건, 승인된 업로드 보존 확인 |
| PostgreSQL SQL | 로컬 PGlite PostgreSQL 엔진에서 스키마/저장/rollback/회사 격리/재연결 성공. 외부 연결 테스트와는 구분 |
| Android 크기 412×915 / iPhone 크기 390×844 | 편집 모달·승인 탭, 페이지 가로 넘침 없음, JavaScript 오류 없음 |
| 로그인 회귀 | 관리자/직원/작업진행자 2명 각각 직접입력과 데모, 8회 성공. 비활성 차단 |
| 견적 회귀 및 종로소방 실제 Excel | 빠른입력/누적/수정단가/단가 OFF/중복 OFF/수동입력 통과. 갑지/기계/전기 3개 시트 및 인쇄영역 확인 |
| GitHub main 반영 | 미실행, 승인 대기 |
| 실제 Render HTTP/자동 배포 | 클라우드 프록시 CONNECT 403. 관리 API 인증 없음. 상태 미확인 |
| 운영 PostgreSQL 접속/자료 이전/Render 재배포 보존 | 미검증. 운영 DB 연결값 및 실행 승인 필요 |

PC와 모바일 테스트에서 잘못된 자동화 선택자 및 예시 행을 삭제하지 못한 테스트용 Excel 구성 문제를 바로잡고 재실행했다. 최종 브라우저 기능 검증은 성공했다. 유효한 XLSX나 현재 UI의 문제가 아닌 자동화 오류를 제품 오류로 보고하지 않았다.

## 자료 보존

작업 전 클라우드 미리보기에서 조회 가능한 자재 566건, 가격이력, 현재 표준작업 및 즐겨찾기를 저장소 외부에 백업한 뒤 로컬 SQLite에 비충돌 병합했다. 구버전 API에는 전체 검토 목록 API가 없어 구버전의 전체 검토/모든 과거 버전을 자동 백업했다고 주장하지 않는다. 사용자 운영 서비스의 자료는 읽거나 이전하거나 삭제하지 않았다. 이미 사라진 메모리 자료를 복원한 것은 아니다. 로컬 DB와 백업은 Git 및 Docker 이미지에서 제외한다.

## 아직 적용하지 않은 사항

실제 운영 DB 연결·백업·자료 이전·마이그레이션·Render 배포와 재배포 후 보존 확인은 운영자 승인과 설정이 필요하다. 자재 외 현장/견적/인증 저장소는 기존 메모리 방식이다. 범용 Excel의 형식 기억은 기존 메모리 기능을 유지한다. 실제 Android/iPhone 하드웨어나 Safari 앱 설치 검증은 수행하지 않았고 해당 화면 크기의 Chromium 반응형 검증을 수행했다. 실제 Render 연결 후 데이터량과 동시접속에 맞춘 운영 성능 검증도 필요하다.

환경변수·Render 설정 위치·새 DB 생성·추가 스키마·백업·자동 배포 점검·복구 절차는 [배포 안내](material-management-deployment.md)에 있다. 현재 `render.yaml`과 운영 서비스는 변경하지 않았다. 클라우드 개발 설치/시작 지침과 Render 공개 주소 읽기용 도메인만 환경 설정 초안에 저장했다. 초안 저장은 활성화나 운영 배포가 아니다.

## 수정·추가한 파일 전체

- `.dockerignore`
- `.env.example`
- `.gitignore`
- `README.md`
- `apps/admin-web/app/globals.css`
- `apps/admin-web/app/material-import-review.tsx`
- `apps/admin-web/app/material-management-panel.tsx`
- `apps/admin-web/app/mobile-workspace.tsx`
- `apps/admin-web/app/operational-workspace.tsx`
- `apps/admin-web/app/quote-quick-input.tsx`
- `apps/admin-web/app/universal-material-import.tsx`
- `apps/admin-web/app/users-panel.tsx`
- `apps/api/migrations/001-material-management.sql`
- `apps/api/package.json`
- `apps/api/scripts/materials-import-backup.ts`
- `apps/api/scripts/materials-migrate.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/company-repository.ts`
- `apps/api/src/company.providers.ts`
- `apps/api/src/main.ts`
- `apps/api/src/material-access.ts`
- `apps/api/src/material-catalog.controller.ts`
- `apps/api/src/material-excel.controller.ts`
- `apps/api/src/material-excel.service.ts`
- `apps/api/src/material-persistence.ts`
- `apps/api/src/material-price.ts`
- `apps/api/src/permission.service.ts`
- `apps/api/src/standard-work-calculator.ts`
- `apps/api/src/standard-work.repository.ts`
- `apps/api/src/standard-work.service.ts`
- `apps/api/src/universal-material-excel.ts`
- `apps/api/test/environment.cjs`
- `apps/api/test/material-excel.test.ts`
- `apps/api/test/material-management.test.ts`
- `deploy/render-materials.example.yaml`
- `deploy/start-preview.cjs`
- `docs/material-management-deployment.md`
- `docs/material-management-verification.md`
- `docs/screenshots/material-edit-android.png`
- `docs/screenshots/material-edit-iphone.png`
- `docs/screenshots/material-history-pc.png`
- `docs/screenshots/material-restart-pc.png`
- `docs/screenshots/material-review-pc.png`
- `package-lock.json`
- `package.json`
- `packages/shared/src/index.ts`

# 종로소방 통합 현장관리

PC 관리자 웹과 공통 API의 실행 가능한 초기 모노레포입니다. 모든 초기 현장/금액은 예시입니다. 등록·수정 데이터는 API 메모리에 저장되며 서버 재시작 시 초기 샘플로 돌아갑니다. 로그인, PostgreSQL, NAS, Flutter 앱은 아직 연결하지 않았습니다.

## 구성

- `apps/admin-web`: Next.js + React + TypeScript 관리자 웹
- `apps/api`: NestJS + TypeScript API
- `packages/shared`: 웹/API 공통 타입 및 메뉴 상수
- `docs`: 요구사항과 향후 데이터모델

## Windows에서 시작하기

Node.js 22 이상 LTS와 Git을 설치하세요. PowerShell 또는 명령 프롬프트에서 아래 명령을 실행합니다. PowerShell의 스크립트 정책으로 `npm.ps1` 실행이 차단되면 `npm` 대신 `npm.cmd`를 사용하세요.

```powershell
git clone https://github.com/kangdaeyoul/app-project.git
cd app-project
npm ci
npm run dev
```

관리자 웹은 `http://localhost:3000`, API 상태 확인은 `http://localhost:4000/api/health`입니다. Ctrl+C로 웹과 API를 함께 종료합니다. Linux/macOS도 동일 명령을 사용합니다. API를 먼저 준비하고 공통 패키지를 빌드하는 작업은 루트 개발 명령에 포함되어 있습니다.

```powershell
npm run build
npm test
npm run typecheck
```

빌드 결과를 실행하려면 두 터미널에서 각각 다음 명령을 실행하세요.

```powershell
npm run start -w @jongno/api
```

```powershell
npm run start -w @jongno/admin-web
```

포트 3000과 4000은 비어 있어야 합니다. 기본 API 주소를 변경하려면 웹 프로세스의 `API_URL`을 설정하세요. API 포트는 `PORT`입니다. 웹의 API 프록시 주소는 빌드 시 반영되므로 운영 빌드 전에 지정합니다.

```powershell
$env:API_URL = 'http://127.0.0.1:4100'
npm run dev -w @jongno/admin-web
# 다른 터미널에서 API를 실행합니다. 최초 실행 전 루트에서 npm run build -w @jongno/shared 실행
$env:PORT = '4100'
npm run dev -w @jongno/api
```

이 예시는 각 터미널의 환경변수를 분리하여 웹 3000/API 4100으로 실행합니다. 현재 인증 없는 샘플용이므로 외부 운영 서비스로 배포하기 전에 인증·권한 및 데이터 저장을 구현해야 합니다.

## API

- `GET /api/health`: 상태 및 sample 모드
- `GET /api/dashboard?month=2026-10`: 월별 현장과 대시보드 집계
- `GET /api/sites`: 전체 현장 목록 (`month=YYYY-MM`으로 일정이 겹치는 월 필터)
- `GET /api/sites/:id`: 현장 상세
- `POST /api/sites`: 현장 등록
- `PUT /api/sites/:id`: 현장 기본정보 전체 수정

대시보드는 월 생략 시 서울 시간 기준 현재 월이며 잘못된 `YYYY-MM` 값은 400을 반환합니다. 서버 시작 시 현재 월의 샘플 5건을 한 번 생성합니다. 월을 이동해도 현장 일정이 바뀌지 않습니다. 달력과 오늘 현장은 시작일부터 종료예정일까지(종료일 미정이면 시작일 하루) 표시합니다. 조회 월과 공사기간이 겹치는 현장이 월 집계에 포함되며, 여러 달에 걸친 공사는 각 해당 월에 전체 금액이 표시됩니다. 매출의 월별 분할이나 수금 원장 집계는 아직 구현되지 않았습니다.

현장 메뉴는 전체 목록, 현장명/거래처/주소 검색, 상태 필터, 등록, 상세, 수정을 제공합니다. 처음 등록 시 현장명과 시작일만 필수이며 금액은 기본 0원, 상태는 미배정입니다. 연락처와 대표 작업진행자는 자유 입력입니다. 상세에는 기본정보와 8개 탭이 있으며 개요·일정은 실제 기본정보를, 수금·정산은 샘플 누계를 보여줍니다. 일일작업·사진·자재/경비·파일 등록은 후속 단계입니다. 공사금액은 VAT 포함 원 단위 정수입니다.

현장 입력 예시:

```json
{
  "name": "소방시설 개선 현장",
  "startDate": "2026-10-06",
  "contractAmount": 0,
  "status": "미배정"
}
```

선택 필드: `client`, `address`, `contactName`, `phone`, `description`, `endDate`, `manager`. 수정은 기본정보 전체를 전송하는 PUT이며 선택 필드 생략 시 빈 값으로 처리됩니다. `id`, 입금액 및 작업진행자 미지급액은 등록·수정 입력에서 변경할 수 없습니다. 데이터베이스와 수금/지급 원장이 추가되기 전까지 입금 및 지급은 초기 샘플 누계입니다.

등록·수정 후 대시보드도 같은 저장소를 조회하여 갱신됩니다. 달력과 오늘 현장, 대시보드 목록의 현장명을 누르면 상세로 이동합니다. API 장애 시 오류와 재시도 버튼을 표시합니다. 테스트는 날짜 경계, 집계, 등록→조회→수정→대시보드 반영, 월 경계 공사, 잘못된 입력과 누락 현장을 확인합니다.

## 확장 경계

`SitesRepository` 인터페이스와 `SITES_REPOSITORY` DI 토큰이 데이터 접근 경계입니다. PostgreSQL 연결 시 새 어댑터를 작성하여 `AppModule`의 바인딩을 교체하세요. 공통 계약은 `packages/shared`에 둡니다. 인증·파일 저장은 독립 모듈로 추가하고 NAS 경로나 비밀정보를 웹에 전달하지 않습니다. Flutter는 다음 단계에 추가합니다.

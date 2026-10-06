# 종로소방 통합 현장관리

PC 관리자 웹과 공통 API의 실행 가능한 초기 모노레포입니다. 모든 현장/금액은 예시이며 저장되지 않습니다. 로그인, PostgreSQL, NAS, Flutter 앱은 아직 연결하지 않았습니다.

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
- `GET /api/sites?month=2026-10`: 월별 현장 목록

월 생략 시 서울 시간 기준 현재 월이며 잘못된 `YYYY-MM` 값은 400을 반환합니다. 샘플 일정은 조회 월에 맞춰 생성되고 현재 월의 두 현장은 오늘로 배치됩니다. 이전/다음 달 조회 시 두 현장은 6일로 배치됩니다. 금액은 원 단위입니다.

홈의 월 이동은 API를 다시 조회합니다. 현장 메뉴는 샘플 목록을 보여주며 나머지 메뉴는 다음 단계 안내 화면입니다. API 장애 시 오류와 재시도 버튼을 표시합니다. 테스트는 서울 날짜 경계, 집계, NestJS HTTP 라우트 및 입력 검증을 확인합니다.

## 확장 경계

`SitesRepository` 인터페이스와 `SITES_REPOSITORY` DI 토큰이 데이터 접근 경계입니다. PostgreSQL 연결 시 새 어댑터를 작성하여 `AppModule`의 바인딩을 교체하세요. 공통 계약은 `packages/shared`에 둡니다. 인증·파일 저장은 독립 모듈로 추가하고 NAS 경로나 비밀정보를 웹에 전달하지 않습니다. Flutter는 다음 단계에 추가합니다.

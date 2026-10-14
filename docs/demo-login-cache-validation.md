# 데모 로그인과 PWA 캐시 점검

## 변경

- API `/api/auth/config`: `Cache-Control: no-store, no-cache, max-age=0, must-revalidate`, `Pragma: no-cache`, `Expires: 0`.
- `DEMO_LOGIN_ENABLED=true`는 API 프로세스 시작 시 읽는다. 기기, UA, 쿠키에 따라 설정을 바꾸지 않는다. 환경변수 변경 후 API 재시작/배포가 필요하다.
- 로그인 설정 조회는 `cache: no-store`. 첫 진입, 화면 복귀, 온라인 복귀, BFCache 복귀 때 재조회한다. 조회 실패를 데모 비활성화와 혼동하지 않도록 오류 안내한다.
- 로그인 HTML과 인증 API에 Next.js 캐시 금지 헤더를 적용한다.
- Service Worker v3: API와 문서 이동은 네트워크 전용/HTTP 캐시 금지. 오프라인 문서 이동은 로그인 폼이 아닌 오프라인 안내만 표시한다. 이미지/아이콘 등 공개 정적 파일만 캐시한다. 이전 앱 정적 캐시를 정리한다.
- SW 스크립트 HTTP 캐시 금지 및 `updateViaCache: none`. 화면 복귀 때 업데이트 확인. 이미 SW가 제어하던 화면에서 새 SW가 활성화되면 로그인 화면은 한 번 새로고침한다. 업무 화면은 저장 전 입력을 보호하기 위해 새로고침 안내만 표시한다.
- 로그인 화면에 웹 빌드 버전과 API 버전을 항상 표시한다. Render의 `RENDER_GIT_COMMIT`을 우선 사용한다. 다른 환경은 `APP_BUILD_VERSION`을 제공할 수 있으며 웹 빌드 전에 설정한다. 별도 공개 비밀키는 필요 없다.
- Render 또는 개발환경에서 데모가 비활성화되면 API 로그에 `demo_login_disabled`와 설정 분류(false/unset/invalid), 재시작 안내를 프로세스당 한 번 기록한다. 비밀번호·토큰·환경변수 원문은 기록하지 않는다.

## 확인

- 현재 공개 Render의 `/api/auth/config`는 `demoEnabled=true`, 이전 `loginRevision=demo-login-2026-10-11-v2`. 응답에 캐시 금지 헤더가 없었다. 수정본은 아직 배포하지 않았다.
- 로컬 production 빌드 PC, iPhone/Android 화면 및 UA, PWA standalone 모사에서 데모 버튼 4개와 버전 표시, 설정 API no-store 확인. 캐시에 오래된 `demoEnabled=false`와 로그인 HTML을 넣어도 최신 응답과 버튼이 유지되는지 확인.
- 실제 iPhone Safari/WebKit, 실제 Android Chrome, OS 홈 화면 설치 PWA는 이 환경에 기기가 없어 미검증이다. 모사는 실제 기기 검증을 대체하지 않는다.
- API 테스트에서 기기 UA/이전 ETag와 무관한 true 응답 및 false 설정의 no-store 응답을 검증한다. 기존 역할 로그인 검증도 유지한다.

## Render 반영 후 관리자 확인

1. 백업과 배포 승인 절차를 먼저 완료한다. 자동 배포를 일으키는 푸시는 이번 작업에서 실행하지 않았다.
2. 테스트 서비스 Environment의 `DEMO_LOGIN_ENABLED`를 정확히 `true`로 설정하고 해당 API 프로세스가 재시작됐는지 확인한다. 운영 서비스에 무조건 데모를 켜지 않는다.
3. `/api/auth/config`의 `demoEnabled`, `buildVersion`, 응답 Cache-Control을 확인한다.
4. PC, iPhone Safari, Android Chrome, 설치 PWA에서 로그인 화면을 열고 웹/API 버전이 동일 배포를 가리키는지 확인한다. 네 가지 체험 버튼이 표시되는지 확인한다.
5. PWA는 온라인 상태로 다시 열어 업데이트 후 확인한다. 완전히 오래된 구버전 SW/오프라인 화면은 새 배포가 강제로 원격 제거할 수 없다. 업데이트 실패 시 해당 사이트 데이터를 정리하거나 PWA를 다시 설치한다. 이는 저장하지 않은 입력을 잃을 수 있으므로 먼저 보관한다.
6. false일 경우 Render Logs의 `demo_login_disabled`를 확인한다. API가 다른 서비스/이전 버전이면 연결 경로와 API 배포도 확인한다.

최종 검증: 빌드·타입 검사 통과, API 테스트 80개 통과/실패 0개.

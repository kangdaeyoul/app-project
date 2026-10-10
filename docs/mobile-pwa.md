# 모바일 PWA 미리보기 구조

PC 관리자 화면과 동일한 Next.js 앱, 인증 제공자, API와 회사별 저장소를 사용한다. 760px 이하에서 MobileWorkspace가 역할별 탐색과 현장 업무 화면을 제공하며 별도 현장/일일작업/스케줄 저장소를 만들지 않는다.

- 임시 브랜드: 공통 APP_BRAND. 회사 표시명/로고는 로그인 세션의 Company 설정.
- 인증: 기존 AuthProvider/HttpOnly 세션. 공개 데모는 DEMO_LOGIN_ENABLED로 버튼과 API, 테스트 계정을 함께 비활성화한다. AuthProvider를 Supabase 어댑터로 교체할 수 있다.
- 일정: worker-schedule 조회 결과를 오늘/이번주/작업진행자별 카드로 표시한다. 본인 조회 범위와 회사 범위는 API PermissionService로 검사한다. 배정 및 충돌 확인은 기존 SchedulePanel을 재사용한다.
- 작업: 기존 DailyWork에 verificationNotes, operationConfirmed를 선택 필드로 추가한다. 과거 기록은 기본 빈 내용/미확인으로 유지한다. 모바일 완료요청은 작업완료 상태이며 관리자확인완료와 구분한다.
- 사진: 기존 PhotoRecord/FileStorage, 실제 multipart 업로드. 카메라 capture 입력은 보조 기능이며 JPEG/PNG/WebP만 저장한다. 본인 배정 검증 후 제한된 operational write 범위에서 저장한다.
- 알림: 기존 NotificationEvent에 dailyWorkId와 신규 배정/일정변경/긴급작업/재확인 이벤트를 추가한다. 메시지/이벤트를 별도 유지하고 실제 푸시는 전송하지 않는다. 동일 값을 재저장하면 변화 이벤트를 재발행하지 않는다.
- 오프라인: 공용 안내 및 아이콘만 캐시. 인증 응답/업무 HTML/API/사진/PDF는 저장하지 않는다. 오프라인 쓰기 또는 동기화 큐는 구현하지 않는다.
- 배포: 단일 인스턴스의 같은 출처 웹/API. API는 내부에만 바인딩한다. 메모리와 임시 파일은 재시작 시 초기화한다. 영구 저장 전에는 샘플 테스트 전용이다.

향후 Flutter에서는 같은 API와 권한 서비스, 회사별 데이터, NotificationEvent를 재사용한다. 현장 오프라인 동기화, Supabase Storage, 실제 푸시는 별도 어댑터로 추가한다.

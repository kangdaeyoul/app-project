# 현장 도우미 자산

역할명은 **현장 도우미**입니다. 회사 로고/확정 앱 이름은 캐릭터에 넣지 않습니다.

`apps/admin-web/public/characters/field-assistant.png`는 투명 배경의 4열 × 2행 포즈 아틀라스입니다. `FieldHelper`와 `HelperCharacter`가 같은 자산을 재사용합니다. UI 문구는 이미지에 포함하지 않으며 회사별 브랜드와 분리되어 있습니다.

| 포즈 키 | 내용 | 적용 위치 |
| --- | --- | --- |
| base | 정면 기본형 | 빈 목록/일정 없음 |
| guide | 손가락 안내 | 가입 신청/첫 사용 안내 |
| check | 체크리스트 확인 | 확인 안내/입력 보조 |
| greeting | 인사 | 로그인/관리자·작업진행자 홈 |
| calendar | 달력 | 관리자 일정/작업진행자 월간 일정 |
| notification | 공지 | 알림센터/작업지시 |
| completed | 승인 | 작업완료 안내용 |
| inspection | 설비 점검 | A/S 관리/빈 A/S 목록 |

기존 `working`, `warning`, `photo`, `quote` 키는 같은 세계관의 새 포즈로 매핑하여 호출부 호환성을 유지합니다. 반응형 크기는 CSS에만 정의되어 있으며 배경색을 자산에 고정하지 않습니다. 이미지에 텍스트를 삽입하지 않아 한글 접근성 문구를 컴포넌트에서 제공합니다.

이번 대화에 원본 브로셔 표지 이미지는 제공되지 않았으므로, 흰 안전모·네이비 작업복·밝고 신뢰감 있는 표정이라는 설명을 기준으로 신규 자산을 제작했습니다. 원본이 제공되면 동일 포즈 API를 유지하면서 자산만 교체할 수 있습니다.

## 브라우저 확인 화면

- [PC 홈](screenshots/character-pc-home.png): 인사 포즈를 기존 요약 카드 위에 배치했습니다.
- [iPhone 작업진행자 홈](screenshots/character-iphone-home.png): 같은 도우미를 모바일 크기로 표시합니다.
- [PC 일정](screenshots/character-pc-schedule.png), [Android 일정](screenshots/character-android-schedule.png): 달력 포즈로 일정 확인을 안내합니다.
- [PC 알림/작업지시](screenshots/character-pc-notification.png): 공지 포즈와 안내 문구를 사용합니다.
- [PC A/S](screenshots/character-pc-as.png): 점검 포즈로 처리 대기 건을 안내합니다.

PC 1440px, Android 412px, iPhone 390px에서 자산 로딩, 로그인 후 실제 업무화면, 화면 가로 넘침, 작업진행자 금액 API 차단을 확인했습니다. 오프라인 안내도 같은 공지 포즈를 사용하며 공개 정적 캐릭터 자산만 PWA 캐시에 포함합니다. 업무 데이터/사진/PDF/API는 캐시하지 않습니다.

export const TUTORIAL_VERSION = 2;
export type TutorialRole = "admin" | "staff" | "worker";
export type TutorialStatus = "new" | "in_progress" | "completed" | "skipped";
export type TutorialScreen =
  | "home"
  | "sites"
  | "quotes"
  | "schedule"
  | "workers"
  | "work"
  | "photos"
  | "materials"
  | "finance"
  | "reports"
  | "notifications"
  | "as"
  | "company"
  | "users"
  | "other";
export interface TutorialStep {
  id: string;
  screen: TutorialScreen;
  title: string;
  text: string;
  sample: string;
  target?: string;
  exercise?: { field: string; value: string | number; instruction: string };
}
export interface TutorialProgress {
  version: number;
  role: TutorialRole;
  status: TutorialStatus;
  step: number;
  updatedAt: string | null;
  samplesPresent: boolean;
}
export interface TutorialSample {
  id: string;
  companyId: string;
  ownerUserId: string;
  isTutorialSample: true;
  kind: string;
  title: string;
  fields: Record<string, string | number>;
}
export interface TutorialBundle {
  isTutorialSample: true;
  companyId: string;
  ownerUserId: string;
  records: TutorialSample[];
}
const GUIDE_STEPS = {
  "intro": {
    "id": "intro",
    "screen": "home",
    "title": "앱 전체 소개 · 한 현장의 업무 흐름",
    "text": "견적 → 현장 → 일정·작업진행자 → 작업·사진·자재 → 정산·완료보고서 → A/S가 연결됩니다. 아래 별도 실습 현장명을 바꿔 저장해 보세요. 실제 목록과 고객 문서에는 들어가지 않습니다.",
    "sample": "sites",
    "exercise": {
      "field": "현장명",
      "value": "[예시] 첫 실습 현장",
      "instruction": "현장명 항목을 “[예시] 첫 실습 현장” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "home": {
    "id": "home",
    "screen": "home",
    "title": "홈 · 월간 캘린더와 오늘 일정",
    "text": "모바일 홈 월간 캘린더에서 날짜를 누르면 그날의 현장·A/S가 보입니다. 예시 일정 시간을 10:00~12:00으로 바꿔 보세요. 실제 일정 등록은 일정 메뉴에서 합니다.",
    "sample": "schedule",
    "exercise": {
      "field": "시간",
      "value": "10:00~12:00",
      "instruction": "시간 항목을 “10:00~12:00” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "site": {
    "id": "site",
    "screen": "sites",
    "title": "현장 · 모든 기록의 연결 기준",
    "text": "현장은 견적의 계약전환 또는 직접 등록으로 만듭니다. 같은 현장 ID로 일정·사진·자재·정산·완료보고서를 묶습니다. 실습 현장의 작업내용을 바꾸고 저장하세요.",
    "sample": "sites",
    "exercise": {
      "field": "작업내용",
      "value": "2층 설비 점검",
      "instruction": "작업내용 항목을 “2층 설비 점검” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "quote": {
    "id": "quote",
    "screen": "quotes",
    "title": "견적 · 품목 한 건 추가와 빈 숫자",
    "text": "실제 견적은 공종 → 품목 한 건 → 추가 → 저장 순서입니다. 숫자를 비우면 강제로 0을 입력하지 않습니다. 실습 수량을 3으로 바꿔 아래 금액이 105,000원이 되는지 확인하세요.",
    "sample": "quotes",
    "exercise": {
      "field": "수량",
      "value": 3,
      "instruction": "수량 항목을 “3” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "quote-profile": {
    "id": "quote-profile",
    "screen": "quotes",
    "title": "견적 · 회사정보와 고객 제출",
    "text": "고정 액션의 회사정보 / 프로필 변경에서 로고·직인까지 수정합니다. 이번 견적 적용은 다른 견적을 바꾸지 않고, 회사 기본정보 저장은 새 견적에 사용됩니다. 저장 후 상세에서 PDF/Excel·수정·복사·공유를 사용합니다. 실습 품명을 바꿔 보세요.",
    "sample": "quotes",
    "exercise": {
      "field": "품명",
      "value": "비상조명등",
      "instruction": "품명 항목을 “비상조명등” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "schedule": {
    "id": "schedule",
    "screen": "schedule",
    "title": "일정 · 등록과 역할별 연결",
    "text": "현장·날짜·시간·대표 및 참여 작업진행자를 지정합니다. 관리자는 회사 일정, 직원은 허용된 현장, 작업진행자는 본인 배정 일정과 작업지시를 봅니다. 예시 상태를 작업중으로 저장한 뒤 아래 역할별 연결을 확인하세요.",
    "sample": "schedule",
    "exercise": {
      "field": "상태",
      "value": "작업중",
      "instruction": "상태 항목을 “작업중” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "worker": {
    "id": "worker",
    "screen": "workers",
    "title": "작업진행자 · 배정과 로그인 연결",
    "text": "작업진행자의 실제 이름·표시명·연락처를 등록하고 현장·일정에 배정합니다. 로그인 사용자의 workerId 연결은 사용자 관리에서 지정합니다. 실습 표시명을 바꿔 보세요.",
    "sample": "workers",
    "exercise": {
      "field": "표시명",
      "value": "실습 진행자",
      "instruction": "표시명 항목을 “실습 진행자” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "work": {
    "id": "work",
    "screen": "work",
    "title": "일일작업 · 시작과 완료 요청",
    "text": "예시 작업 시작을 누르면 예시에만 시작시각이 기록됩니다. 작업내용·실제 사용자재·전후사진 확인 후 예시 완료 요청을 누르세요. 관리자 확인완료와 작업진행자의 완료요청은 다릅니다.",
    "sample": "work",
    "exercise": {
      "field": "상태",
      "value": "완료요청",
      "instruction": "상태 항목을 “완료요청” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "photo": {
    "id": "photo",
    "screen": "photos",
    "title": "사진 · 전후 구분과 위치",
    "text": "같은 위치에서 작업 전·후를 촬영합니다. 현장·일일작업과 연결한 사진은 사진대지·완료보고서에서 사용합니다. 실습 위치를 2층 복도로 저장하고 전후사진을 비교하세요.",
    "sample": "photos",
    "exercise": {
      "field": "작업위치",
      "value": "2층 복도",
      "instruction": "작업위치 항목을 “2층 복도” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "material": {
    "id": "material",
    "screen": "materials",
    "title": "자재 · 실제 사용과 구매 구분",
    "text": "사용자재는 실제 사용량, 구매·지출은 비용 기록입니다. 서로 자동 환산되지 않습니다. 실습 사용수량을 2로 바꿔 저장해 보세요. 운영 단가와 견적 가격은 바뀌지 않습니다.",
    "sample": "materials",
    "exercise": {
      "field": "수량",
      "value": 2,
      "instruction": "수량 항목을 “2” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "finance": {
    "id": "finance",
    "screen": "finance",
    "title": "정산 · 수금·미수와 지급",
    "text": "현장의 계약액·수금 원장·지출·작업진행자 지급을 구분합니다. 월간 현금흐름과 전체 기간 현장손익은 기준이 다릅니다. 실습 수금액을 4,500,000원으로 바꿔 계산된 미수금을 확인하세요.",
    "sample": "settlements",
    "exercise": {
      "field": "수금액",
      "value": 4500000,
      "instruction": "수금액 항목을 “4500000” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "report": {
    "id": "report",
    "screen": "reports",
    "title": "완료보고서 · 현장 기록을 문서로",
    "text": "현장과 작업기간을 선택하고 일일작업·사용자재·사진을 모아 미리본 뒤 PDF를 내려받습니다. 실습 요약을 바꿔 보고서에 들어갈 내용을 연습하세요.",
    "sample": "reports",
    "exercise": {
      "field": "요약",
      "value": "설비 점검 및 동작 확인 완료",
      "instruction": "요약 항목을 “설비 점검 및 동작 확인 완료” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "as": {
    "id": "as",
    "screen": "as",
    "title": "A/S · 기존 현장과 후속 작업",
    "text": "기존 현장에 요청을 접수하고 배정 → 작업중 → 처리완료 → 관리자 확인·종결 순으로 진행합니다. 작업진행자는 본인 배정건만 처리합니다. 실습 처리내용을 저장하세요.",
    "sample": "as",
    "exercise": {
      "field": "처리내용",
      "value": "점검 후 정상 동작 확인",
      "instruction": "처리내용 항목을 “점검 후 정상 동작 확인” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "participant": {
    "id": "worker",
    "screen": "workers",
    "title": "작업진행자 · 내 배정과 동료 확인",
    "text": "배정된 현장의 대표·참여 작업진행자를 확인합니다. 계정 연결과 배정 변경은 관리자에게 요청합니다. 별도 실습 표시명을 바꿔 보세요.",
    "sample": "workers",
    "exercise": {
      "field": "표시명",
      "value": "실습 진행자",
      "instruction": "표시명 항목을 “실습 진행자” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "notice": {
    "id": "notice",
    "screen": "notifications",
    "title": "작업지시 · 배정된 현장 확인",
    "text": "본인에게 온 작업지시와 일정 변경을 확인합니다. 직원은 허용된 현장, 작업진행자는 본인 배정 현장에 접근합니다. 실습 현장 담당자를 바꿔 저장해 보세요.",
    "sample": "sites",
    "exercise": {
      "field": "담당자",
      "value": "실습 담당자",
      "instruction": "담당자 항목을 “실습 담당자” 값으로 바꾸고 예시에만 저장하세요."
    }
  },
  "own-finance": {
    "id": "own-finance",
    "screen": "finance",
    "title": "내 정산 · 본인 작업비만 확인",
    "text": "작업진행자는 본인 지급예정·지급·미지급만 확인합니다. 회사 손익과 다른 작업자의 금액은 볼 수 없습니다. 실습 내지급액을 250,000원으로 바꿔 보세요.",
    "sample": "settlements",
    "exercise": {
      "field": "내지급액",
      "value": 250000,
      "instruction": "내지급액 항목을 “250000” 값으로 바꾸고 예시에만 저장하세요."
    }
  }
} satisfies Record<string, TutorialStep>;

export const TUTORIAL_STEPS: Record<TutorialRole, TutorialStep[]> = {
  admin: [
    GUIDE_STEPS.intro,
    GUIDE_STEPS.home,
    GUIDE_STEPS.site,
    GUIDE_STEPS.quote,
    GUIDE_STEPS["quote-profile"],
    GUIDE_STEPS.schedule,
    GUIDE_STEPS.worker,
    GUIDE_STEPS.work,
    GUIDE_STEPS.photo,
    GUIDE_STEPS.material,
    GUIDE_STEPS.finance,
    GUIDE_STEPS.report,
    GUIDE_STEPS.as,
  ],
  staff: [
    GUIDE_STEPS.intro,
    GUIDE_STEPS.home,
    GUIDE_STEPS.site,
    GUIDE_STEPS.schedule,
    GUIDE_STEPS.quote,
    GUIDE_STEPS["quote-profile"],
    GUIDE_STEPS.participant,
    GUIDE_STEPS.work,
    GUIDE_STEPS.photo,
    GUIDE_STEPS.material,
    GUIDE_STEPS.report,
    GUIDE_STEPS.as,
    GUIDE_STEPS.notice,
  ],
  worker: [
    GUIDE_STEPS.intro,
    GUIDE_STEPS.home,
    GUIDE_STEPS.site,
    GUIDE_STEPS.schedule,
    GUIDE_STEPS.notice,
    GUIDE_STEPS.participant,
    GUIDE_STEPS.work,
    GUIDE_STEPS.photo,
    GUIDE_STEPS.material,
    GUIDE_STEPS["own-finance"],
    GUIDE_STEPS.as,
  ],
};
export function tutorialSteps(role: TutorialRole, writeQuotes = true) {
  return TUTORIAL_STEPS[role].filter(s => role !== "staff" || writeQuotes || s.screen !== "quotes");
}
export function canonicalScreen(menu: string): TutorialScreen {
  if (/홈|오늘 일정/.test(menu)) return "home";
  if (/현장 재무|정산/.test(menu)) return "finance";
  if (/현장/.test(menu)) return "sites";
  if (/견적/.test(menu)) return "quotes";
  if (/스케줄|일정|휴무|배정관리/.test(menu)) return "schedule";
  if (/작업진행자/.test(menu)) return "workers";
  if (/사진/.test(menu)) return "photos";
  if (/완료보고서|출력/.test(menu)) return "reports";
  if (/알림|작업지시/.test(menu)) return "notifications";
  if (/A\/S/.test(menu)) return "as";
  if (/자재/.test(menu)) return "materials";
  if (/회사 설정/.test(menu)) return "company";
  if (/사용자/.test(menu)) return "users";
  if (/작업/.test(menu)) return "work";
  return "other";
}
export const SCREEN_HELP: Record<TutorialScreen, string> = {
  home: "오늘 현장·A/S와 미확인 알림을 확인한 뒤 필요한 업무로 이동하세요.",
  sites:
    "목록에서 현장을 열면 일정·일일작업·사진·자재·보고서를 확인할 수 있습니다. 저장은 실제 업무 데이터에 반영됩니다.",
  quotes:
    "공종 선택 → 품목 추가 → 금액 확인 → 저장 순서입니다. 견적 상세에서 수정·복사·공유·출력을 선택하세요.",
  schedule: "날짜와 작업진행자를 선택해 일정·휴무·시간 중복을 확인하세요.",
  workers:
    "실제 이름·표시명·연락처와 가용상태를 관리합니다. 현장에 연결된 과거 기록은 유지됩니다.",
  work: "현장과 작업진행자를 확인하고 시작·종료 시각, 작업내용·자재·사진을 입력하세요.",
  photos:
    "작업 전/후 구분·위치·설명을 남기세요. 현장별 사진대지를 출력할 수 있습니다.",
  materials:
    "실제 사용자재와 구매·지출은 서로 다른 기록입니다. 엑셀 자료는 검토 후 승인해야 반영됩니다.",
  finance:
    "수금·미수·작업진행자 지급을 기록합니다. 현장차익은 회사 전체 회계상 이익과 다릅니다.",
  reports:
    "현장과 작업기간을 확인하고 일일작업·사용자재·사진을 불러와 PDF를 미리보세요.",
  notifications:
    "본인에게 온 일정·A/S·작업지시를 확인하세요. 중요한 작업지시는 읽음 여부가 기록됩니다.",
  as: "기존 현장에 A/S를 접수하고 배정 → 작업 → 처리완료 → 관리자 확인·종결 순서로 진행합니다.",
  company:
    "회사 기본정보는 새 견적에 사용됩니다. 과거 견적의 회사정보 스냅샷은 유지됩니다.",
  users:
    "가입 신청과 소속·역할·활성 상태를 검토하세요. 다른 회사 사용자에게 권한을 부여하지 마세요.",
  other:
    "필요한 항목을 확인한 뒤 저장하세요. 아래 도움말에서 역할별 튜토리얼을 다시 시작할 수 있습니다.",
};
export function tutorialCacheKey(company: string, user: string, role: string) {
  return (
    "field-tutorial:" + JSON.stringify([company, user, role, TUTORIAL_VERSION])
  );
}
export function sampleSeed(
  companyId: string,
  userId: string,
  role: TutorialRole,
  writeQuotes = true,
): TutorialBundle {
  const prefix =
    "tutorial:" +
    encodeURIComponent(companyId) +
    ":" +
    encodeURIComponent(userId) +
    ":";
  const rows: [string, string, Record<string, string | number>][] = [
    ...(role==="admin" ? [["company","[예시] 회사정보",{회사명:"[예시] 주식회사 ○○소방",대표자:"홍길동",사업자등록번호:"123-45-67890",주소:"서울특별시 ○○구 ○○로 123",전화:"02-1234-5678",이메일:"company@example.com",안내문구:"현장 확인 후 견적을 확정합니다."}] as [string,string,Record<string,string|number>]]:[]),
    [
      "customers",
      "[예시] ○○건설",
      { 거래처명: "[예시] ○○건설", 담당자: "김담당", 연락처: "02-000-0000" },
    ],
    [
      "sites",
      "[예시] ○○빌딩 소방시설 보수공사",
      {
        현장명: "[예시] ○○빌딩",
        연결안내: "견적 → 현장 → 일정·작업 → 사진·자재 → 정산·완료보고서 → A/S",
        주소: "서울특별시 ○○구 ○○로 123",
        작업내용: "3층 감지기 증설",
        담당자: "김담당",
      },
    ],
    [
      "workers",
      "[예시] 현장 도우미",
      { 이름: "홍길동", 표시명: "홍길동 소장", 연락처: "010-0000-0000" },
    ],
    [
      "schedule",
      "[예시] 오늘 작업 일정",
      { 현장: "[예시] ○○빌딩", 날짜: new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()), 시간: "09:00~12:00", 상태: "배정완료", 작업진행자: "[예시] 현장 도우미" },
    ],
    [
      "work",
      "[예시] 감지기 증설 작업",
      {
        작업내용: "3층 감지기 증설",
        상태: "작업예정",
          시작시간:"",종료시간:"",
        시험확인: "동작 확인 예정",
      },
    ],
    [
      "photos",
      "[예시] 작업 전후사진",
      {
        작업위치: "3층 복도",
        설명: "동일 위치에서 촬영한 예시",
        작업전: "/tutorial/sample-before.png",
        작업후: "/tutorial/sample-after.png",
        추가사진수: 0,
      },
    ],
    [
      "materials",
      "[예시] 사용자재",
      { 자재명: "화재감지기(연기식)", 규격: "일반형", 수량: 5, 단위: "개" },
    ],
    ["as", "[예시] 현장 후속 A/S", { 현장: "[예시] ○○빌딩", 요청내용: "설비 작동 재확인", 상태: "접수", 처리내용: "" }],
    [
      "reports",
      "[예시] 공사 완료보고서",
      {
        현장: "[예시] ○○빌딩",
        요약: "감지기 설치 및 동작 확인",
        의견: "현장 조건 확인 필요 · 제출용 문서 아님",
      },
    ],
  ];
  if (role === "admin" || (role === "staff" && writeQuotes))
    rows.push([
      "quotes",
      "[예시] 감지기 증설 견적",
      {
        품명: "화재감지기(연기식)",
        규격: "일반형",
        수량: 5,
        단위: "개",
        단가: 35000,
      },
    ]);
  if (role === "admin")
    rows.push([
      "settlements",
      "[예시] 현장 정산",
      { 계약금액: 5500000, 수금액: 4000000, 미수금: 1500000 },
    ]);
  if (role === "worker")
    rows.push([
      "settlements",
      "[예시] 내 정산",
      { 내작업비: 350000, 내지급액: 200000, 내미지급액: 150000 },
    ]);
  return {
    isTutorialSample: true,
    companyId,
    ownerUserId: userId,
    records: rows.map(([kind, title, fields]) => ({
      id: prefix + kind,
      companyId,
      ownerUserId: userId,
      isTutorialSample: true,
      kind,
      title,
      fields,
    })),
  };
}

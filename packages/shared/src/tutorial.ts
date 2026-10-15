export const TUTORIAL_VERSION = 1;
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
export const TUTORIAL_STEPS: Record<TutorialRole, TutorialStep[]> = {
  admin: [
    {
      id: "site",
      screen: "sites",
      title: "현장 등록",
      text: "새 현장 등록에서 이름·일정·대표 작업진행자를 입력합니다. 아래 체험은 실제 현장에 저장되지 않습니다.",
      sample: "sites",
      target: "새 현장 등록",
    },
    {
      id: "quote",
      screen: "quotes",
      title: "견적 작성",
      text: "새 견적에서 공종을 선택하고 품목을 추가합니다. 상세보기에서 수정·복사·PDF/Excel 출력을 할 수 있습니다.",
      sample: "quotes",
      target: "새 견적 작성",
    },
    {
      id: "schedule",
      screen: "schedule",
      title: "일정 배정",
      text: "작업진행자의 가용상태와 중복 시간을 확인한 뒤 배정합니다.",
      sample: "schedule",
    },
    {
      id: "worker",
      screen: "workers",
      title: "작업진행자 연결",
      text: "실제 이름과 표시명을 구분하고, 현장의 대표 작업진행자로 연결하세요.",
      sample: "workers",
      target: "새 작업진행자 등록",
    },
    {
      id: "review",
      screen: "work",
      title: "사진·사용자재 확인",
      text: "일일작업에서 작업내용, 전후사진과 실제 사용한 자재를 확인합니다. 구매 기록과 사용자재는 별개입니다.",
      sample: "photos",
      target: "새 일일작업",
    },
    {
      id: "finance",
      screen: "finance",
      title: "정산 확인",
      text: "수금·미수와 작업진행자 지급을 확인합니다. 일부 수금·일부 지급도 기록할 수 있습니다.",
      sample: "settlements",
    },
    {
      id: "report",
      screen: "sites",
      title: "완료보고서",
      text: "현장 상세의 완료보고서 탭에서 작업·사용자재·사진을 모아 PDF로 출력합니다.",
      sample: "reports",
    },
  ],
  staff: [
    {
      id: "site",
      screen: "sites",
      title: "허용된 현장 확인",
      text: "권한이 있는 현장만 표시됩니다. 현장명과 주소, 작업 목적을 먼저 확인하세요.",
      sample: "sites",
    },
    {
      id: "schedule",
      screen: "schedule",
      title: "일정 확인",
      text: "배정된 일정과 작업진행자의 가용상태를 확인합니다.",
      sample: "schedule",
    },
    {
      id: "quote",
      screen: "quotes",
      title: "견적 작성",
      text: "견적 작성 권한이 있으면 품목을 넣고 저장할 수 있습니다. 내부 재무정보는 추가 권한을 따릅니다.",
      sample: "quotes",
      target: "새 견적 작성",
    },
    {
      id: "work",
      screen: "work",
      title: "작업내용과 사용자재",
      text: "일일작업에 작업내용과 실제 사용한 자재를 입력합니다.",
      sample: "materials",
    },
    {
      id: "photo",
      screen: "photos",
      title: "작업 전후사진",
      text: "작업 전·후 사진을 구분하고 같은 위치에서 촬영해 설명을 남기세요.",
      sample: "photos",
    },
    {
      id: "report",
      screen: "reports",
      title: "완료보고서",
      text: "일일작업과 사진을 확인한 뒤 보고서를 미리보고 출력합니다.",
      sample: "reports",
    },
  ],
  worker: [
    {
      id: "today",
      screen: "home",
      title: "오늘 현장",
      text: "오늘 현장과 A/S, 다음 일정, 긴급건을 먼저 확인하세요.",
      sample: "schedule",
    },
    {
      id: "instructions",
      screen: "notifications",
      title: "작업내용·지시 확인",
      text: "본인에게 온 작업지시를 읽고 현장 도착 전 연락 등 중요사항을 확인하세요.",
      sample: "sites",
    },
    {
      id: "start",
      screen: "work",
      title: "작업 시작",
      text: "내 작업을 선택해 작업 시작을 누릅니다. 아래 체험 버튼은 실제 출근·작업기록을 바꾸지 않습니다.",
      sample: "work",
    },
    {
      id: "photo",
      screen: "photos",
      title: "작업 전후사진 등록",
      text: "전·후 사진을 같은 위치에서 촬영하고 위치와 설명을 입력합니다.",
      sample: "photos",
    },
    {
      id: "material",
      screen: "work",
      title: "사용자재 입력",
      text: "실제로 사용한 자재의 규격·수량·단위를 남기세요.",
      sample: "materials",
    },
    {
      id: "complete",
      screen: "work",
      title: "완료 요청",
      text: "작업내용과 시험/확인 결과, 사진을 확인한 뒤 완료를 요청합니다. 관리자 확인과 구분됩니다.",
      sample: "work",
    },
  ],
};
export function tutorialSteps(role: TutorialRole, writeQuotes = true) {
  return TUTORIAL_STEPS[role].map((s) =>
    role === "staff" && !writeQuotes && s.screen === "quotes"
      ? {
          id: "instructions",
          screen: "notifications" as const,
          title: "작업지시 확인",
          text: "견적 작성 권한이 없는 계정은 작업지시를 확인하고 현장 업무를 이어갑니다.",
          sample: "sites",
        }
      : s,
  );
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
      { 현장: "[예시] ○○빌딩", 시간: "09:00~12:00", 상태: "배정완료" },
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

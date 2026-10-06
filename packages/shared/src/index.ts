export const APP_NAME = '종로소방 통합 현장관리';
export const MENU_ITEMS = ['홈', '현장', '견적', '작업진행자', '일일작업', '자재·경비', '정산', '실적', '출력'] as const;
export type SiteStatus = '진행중' | '완료' | '미배정';
export interface Site { id: string; name: string; address: string; date: string; status: SiteStatus; manager: string | null; contractAmount: number; collectedAmount: number; unpaidWorkerAmount: number }
export interface Dashboard { month: string; today: string; sites: Site[]; summary: { todaySites: number; inProgress: number; completed: number; unassigned: number; contractRevenue: number; collected: number; receivables: number; unpaidWorkers: number } }

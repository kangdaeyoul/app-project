export const APP_NAME = '종로소방 통합 현장관리';
export const MENU_ITEMS = ['홈', '현장', '견적', '작업진행자', '일일작업', '자재·경비', '정산', '실적', '출력'] as const;
export const SITE_STATUSES = ['미배정', '진행중', '완료'] as const;
export type SiteStatus = typeof SITE_STATUSES[number];
export interface SiteInput {
  name: string; client: string; address: string; contactName: string; phone: string;
  description: string; startDate: string; endDate: string; contractAmount: number;
  manager: string | null; managerId?: string | null; status: SiteStatus;
}
export interface Site extends SiteInput {
  id: string; collectedAmount: number; unpaidWorkerAmount: number;
}
export const isSiteOnDate = (site: Site, date: string) => site.startDate <= date && date <= (site.endDate || site.startDate);
export interface Dashboard { month: string; today: string; sites: Site[]; summary: { todaySites: number; inProgress: number; completed: number; unassigned: number; contractRevenue: number; collected: number; receivables: number; unpaidWorkers: number } }

export const AVAILABILITY_STATUSES = ['근무가능', '휴무', '오전불가', '오후불가'] as const;
export type AvailabilityStatus = typeof AVAILABILITY_STATUSES[number];
export interface WorkerInput { name: string; displayName: string; phone: string; role: string; memo: string; defaultAvailability: AvailabilityStatus }
// Operational role is not an authentication permission. Future User identities link by workerId.
export interface Worker extends WorkerInput { id: string; deletedAt: string | null }
export interface WorkerAvailability { date: string; status: AvailabilityStatus }
export interface WorkerWork { id: string; siteId: string; date: string; scheduledAmount: number; paidAmount: number }
export interface WorkerSummary extends Worker { availability: AvailabilityStatus; todaySiteCount: number; monthlyWorkDays: number; monthlyPayable: number; unpaidAmount: number }
export interface WorkerDetail extends WorkerSummary { sites: Site[]; work: WorkerWork[]; availabilityDates: WorkerAvailability[]; month: string }

export const DAILY_WORK_STATUSES = ['작업예정', '작업중', '작업완료', '관리자확인완료'] as const;
export type DailyWorkStatus = typeof DAILY_WORK_STATUSES[number];
export interface DailyWorkInput { workDate: string; siteId: string; managerId: string; participantIds: string[]; startTime: string; endTime: string; content: string; notes: string; status: DailyWorkStatus; materials?: MaterialUsageInput[] }
export interface DailyWorkParticipant { dailyWorkId: string; workerId: string; displayName: string }
export interface DailyWorkRecord extends Omit<DailyWorkInput, 'participantIds' | 'materials'> { id: string; siteName: string; managerDisplayName: string; beforePhotoCount: number; afterPhotoCount: number }
export interface DailyWork extends DailyWorkRecord { materialCount: number; participants: DailyWorkParticipant[]; totalMinutes: number | null; materials: MaterialUsage[] }
export function workMinutes(start: string, end: string): number | null { if (!start || !end) return null; const minutes = (time: string) => { const [h,m] = time.split(':').map(Number); return h*60+m; }; return minutes(end)-minutes(start); }

export interface Material { id: string; name: string; specification: string; unit: string }
export interface MaterialUsageInput { id?: string; name: string; specification: string; quantity: number; unit: string; notes: string }
export interface MaterialUsage extends MaterialUsageInput { id: string; materialId: string; dailyWorkId: string }
export interface SiteMaterialUsage extends MaterialUsage { workDate: string; siteId: string; dailyWorkContent: string; managerDisplayName: string }
export interface SiteMaterialTotal { name: string; specification: string; unit: string; quantity: number }
export interface SiteMaterials { usages: SiteMaterialUsage[]; totals: SiteMaterialTotal[] }

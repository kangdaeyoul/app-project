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
export interface Dashboard { month: string; today: string; sites: Site[]; summary: { todaySites: number; inProgress: number; completed: number; unassigned: number; contractRevenue: number; collected: number; receivables: number; unpaidWorkers: number; totalExpenses: number; siteProfit: number; taxWarnings: TaxWarnings } }

export const AVAILABILITY_STATUSES = ['근무가능', '휴무', '오전불가', '오후불가'] as const;
export type AvailabilityStatus = typeof AVAILABILITY_STATUSES[number];
export interface WorkerInput { name: string; displayName: string; phone: string; role: string; memo: string; defaultAvailability: AvailabilityStatus }
// Operational role is not an authentication permission. Future User identities link by workerId.
export interface Worker extends WorkerInput { id: string; deletedAt: string | null }
export interface WorkerAvailability { date: string; status: AvailabilityStatus }
export interface WorkerWork { id: string; siteId: string; date: string; scheduledAmount: number; paidAmount: number }
export interface WorkerSummary extends Worker { availability: AvailabilityStatus; todaySiteCount: number; monthlyWorkDays: number; monthlyPayable: number; unpaidAmount: number }
export interface WorkerDetail extends WorkerSummary { sites: Site[]; work: WorkerWork[]; availabilityDates: WorkerAvailability[]; month: string; expenseSettlement: WorkerExpenseTotals }

export const DAILY_WORK_STATUSES = ['작업예정', '작업중', '작업완료', '관리자확인완료'] as const;
export type DailyWorkStatus = typeof DAILY_WORK_STATUSES[number];
export interface DailyWorkInput { workDate: string; siteId: string; managerId: string; participantIds: string[]; startTime: string; endTime: string; content: string; notes: string; status: DailyWorkStatus; materials?: MaterialUsageInput[] }
export interface DailyWorkParticipant { dailyWorkId: string; workerId: string; displayName: string }
export interface DailyWorkRecord extends Omit<DailyWorkInput, 'participantIds' | 'materials'> { id: string; siteName: string; managerDisplayName: string; }
export interface DailyWork extends DailyWorkRecord { beforePhotoCount: number; afterPhotoCount: number; materialCount: number; participants: DailyWorkParticipant[]; totalMinutes: number | null; materials: MaterialUsage[] }
export function workMinutes(start: string, end: string): number | null { if (!start || !end) return null; const minutes = (time: string) => { const [h,m] = time.split(':').map(Number); return h*60+m; }; return minutes(end)-minutes(start); }

export interface Material { id: string; name: string; specification: string; unit: string }
export interface MaterialUsageInput { id?: string; name: string; specification: string; quantity: number; unit: string; notes: string }
export interface MaterialUsage extends MaterialUsageInput { id: string; materialId: string; dailyWorkId: string }
export interface SiteMaterialUsage extends MaterialUsage { workDate: string; siteId: string; dailyWorkContent: string; managerDisplayName: string }
export interface SiteMaterialTotal { name: string; specification: string; unit: string; quantity: number }
export interface SiteMaterials { usages: SiteMaterialUsage[]; totals: SiteMaterialTotal[] }

export const PHOTO_TYPES = ['작업 전', '작업 후'] as const;
export type PhotoType = typeof PHOTO_TYPES[number];
export interface PhotoRecord { id: string; dailyWorkId: string; type: PhotoType; location: string; description: string; capturedAt: string | null; uploadedBy: string; sortOrder: number; originalFilename: string; storageKey: string; mimeType: string; size: number; createdAt: string; isSample: boolean }
export interface PhotoView extends PhotoRecord { siteId: string; workDate: string; url: string }
export interface PhotoMetadata { location: string; description: string; capturedAt: string | null; uploadedBy: string }


export const EXPENSE_TYPES = ['회사 직접 자재구매', '작업진행자 대납 자재구매', '작업비', '기타경비'] as const;
export const PAYMENT_METHODS = ['법인카드', '회사계좌이체', '회사현금', '작업진행자 대납', '기타'] as const;
export const EVIDENCE_TYPES = ['세금계산서', '카드전표', '현금영수증', '간이영수증', '증빙없음'] as const;
export type ExpenseType = typeof EXPENSE_TYPES[number];
export interface ExpenseInput {
  expenseDate: string; siteId: string; dailyWorkId: string | null; type: ExpenseType;
  description: string; vendor: string; quantity: number; unit: string;
  supplyAmount: number; vat: number; paymentMethod: typeof PAYMENT_METHODS[number];
  evidenceType: typeof EVIDENCE_TYPES[number]; purchaser: string; workerId: string | null;
  isWorkerAdvance: boolean; settled: boolean; settlementDate: string | null; notes: string;
  receiptFileKey: string | null;
}
export interface ExpenseRecord extends Omit<ExpenseInput, 'quantity' | 'unit' | 'workerId'> {
  id: string; siteName: string; createdAt: string; updatedAt: string;
}
export interface ExpenseLineItem { expenseId: string; quantity: number; unit: string }
export interface WorkerSettlement { expenseId: string; workerId: string; displayName: string }
export interface Expense extends ExpenseRecord { quantity: number; unit: string; workerId: string | null; workerDisplayName: string | null; totalAmount: number; paidAmount?: number; payoutStatus?: typeof PAYOUT_STATUSES[number]; invoiceReceiptStatus?: typeof PURCHASE_INVOICE_STATUSES[number] }
export interface ExpenseTotals { directMaterials: number; workerAdvances: number; labor: number; other: number; total: number }
export interface WorkerExpenseTotals { labor: number; advances: number; totalPayable: number; settledAmount: number; unpaidAmount: number }
export interface ExpenseList { items: Expense[]; totals: ExpenseTotals; workerTotals: WorkerExpenseTotals }

export const RECEIPT_METHODS = ['계좌이체', '카드결제', '현금', '기타'] as const;
export const PAYOUT_STATUSES = ['미지급', '일부지급', '지급완료'] as const;
export interface PaymentReceivedInput { receivedDate: string; siteId: string; amount: number; method: typeof RECEIPT_METHODS[number]; payer: string; notes: string }
export interface PaymentReceived extends PaymentReceivedInput { id: string; createdAt: string }
export interface WorkerPaymentInput { paymentDate: string; siteId: string; workerId: string; amount?: number; fullPayment?: boolean; notes: string }
export interface WorkerPayment { id: string; paymentDate: string; siteId: string; workerId: string; amount: number; notes: string; createdAt: string }
export interface WorkerPaymentAllocation { paymentId: string; expenseId: string; amount: number }
export interface SettlementItem { id: string; siteId: string; workerId: string; workerDisplayName: string; expenseDate: string; description: string; category: '작업비' | '자재대납' | '기타정산'; amount: number; paidAmount: number; unpaidAmount: number }
export interface SettlementSummary { siteId: string; siteName: string; workerId: string; workerDisplayName: string; labor: number; materialAdvances: number; other: number; totalPayable: number; paidAmount: number; unpaidAmount: number; status: typeof PAYOUT_STATUSES[number]; lastPaymentDate: string | null; invoiceStatus: typeof WORKER_INVOICE_STATUSES[number]; items: SettlementItem[] }
export interface SettlementList { workers: {workerId: string; workerDisplayName: string; deletedAt: string | null; totalPayable: number; paidAmount: number; unpaidAmount: number}[]; rows: SettlementSummary[]; payments: WorkerPayment[]; totals: { totalPayable: number; paidAmount: number; unpaidAmount: number }; monthly: { month: string; totalPayable: number; paidAmount: number; unpaidAmount: number } }
export interface SiteFinance { siteId: string; contractAmount: number; collectedAmount: number; receivables: number; directMaterials: number; materialAdvances: number; labor: number; other: number; totalExpenses: number; siteProfit: number; unpaidWorkerAmount: number }

export const SALES_INVOICE_STATUSES = ['미발행', '발행완료', '발행불필요'] as const;
export const PURCHASE_INVOICE_STATUSES = ['미수취', '수취완료', '해당없음'] as const;
export const WORKER_INVOICE_STATUSES = ['미발행', '발행완료', '해당없음'] as const;
export interface BusinessParty { registrationNumber: string; name: string; representative: string; address: string; businessType: string; businessItem: string; email: string }
export interface InvoiceMetadata { counterparty: string; supplyAmount: number; vat: number; date: string | null; approvalNumber: string; notes: string; supplier: BusinessParty; recipient: BusinessParty }
export interface SalesInvoice extends InvoiceMetadata { siteId: string; status: typeof SALES_INVOICE_STATUSES[number]; receiptIds: string[] }
export interface PurchaseInvoice extends InvoiceMetadata { expenseId: string; siteId: string; status: typeof PURCHASE_INVOICE_STATUSES[number] }
export interface WorkerInvoice { siteId: string; workerId: string; status: typeof WORKER_INVOICE_STATUSES[number]; date: string | null; approvalNumber: string; notes: string }
export interface SalesInvoiceView extends SalesInvoice { siteName: string; totalAmount: number; collectedAmount: number }
export interface PurchaseInvoiceView extends PurchaseInvoice { siteName: string; totalAmount: number; expenseDescription: string; workerId: string | null }
export interface WorkerInvoiceView extends WorkerInvoice { siteName: string; workerDisplayName: string; totalPayable: number }
export interface EvidenceExpense { id: string; siteId: string; siteName: string; description: string; evidenceType: typeof EVIDENCE_TYPES[number]; receiptStatus: typeof PURCHASE_INVOICE_STATUSES[number]; totalAmount: number; workerId: string | null }
export interface TaxWarnings { salesUnissued: number; purchasesUnreceived: number; noEvidence: number; workerUnreceived: number }
export interface InvoiceList { sales: SalesInvoiceView[]; purchases: PurchaseInvoiceView[]; workers: WorkerInvoiceView[]; expenses: EvidenceExpense[]; warnings: TaxWarnings }

export const PHOTO_REPORT_LAYOUTS = ['작업 전/후 비교형', '페이지당 4장', '페이지당 6장'] as const;
export interface PhotoReportOptions {
  layout: typeof PHOTO_REPORT_LAYOUTS[number];
  workDate: string;
  type: '' | PhotoType;
  selection: '전체 사진' | '선택한 사진만';
  photoIds: string[];
  title: string;
  companyName: string;
  workContent: string;
  periodStart: string;
  periodEnd: string;
  createdDate: string;
  showWorker: boolean;
  showNumber: boolean;
  showTime: boolean;
}

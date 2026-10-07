export const APP_NAME = '현장관리'; // Provisional shared app brand; company branding is configured separately.
export const MENU_ITEMS = ['홈', '현장', '견적', '작업진행자', '일일작업', '자재·경비', '정산', '실적', '출력'] as const;
export const SITE_STATUSES = ['미배정', '진행중', '완료'] as const;
export type SiteStatus = typeof SITE_STATUSES[number];
export interface SiteInput {
  name: string; client: string; address: string; contactName: string; phone: string;
  description: string; startDate: string; endDate: string; contractAmount: number;
  manager: string | null; managerId?: string | null; status: SiteStatus; clientId?: string | null; trades?: ('기계' | '전기')[]; tradeNames?: string[];
}
export interface Site extends SiteInput {
  id: string; collectedAmount: number; unpaidWorkerAmount: number; deletedAt?: string | null;
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

export const QUOTE_STATUSES = ['작성중', '제출완료', '수정요청', '승인', '계약전환', '취소'] as const;
export const QUOTE_SECTIONS = ['기계', '전기'] as const;
export const QUOTE_PRINT_MODES = ['전체 상세', '단가 숨김', '금액 숨김', '공종별 묶음', '총액 위주'] as const;
export const QUOTE_PRICE_CATEGORIES = ['재료비', '노무비', '경비'] as const;
export interface Customer { id: string; name: string; address: string; contactName: string; phone: string }
export interface QuoteItemInput {
  customerGroup?: string;
  standardSource?: { templateId: string; version: number; componentId: string };
  trade: string; name: string; specification: string; quantity: number; unit: string;
  materialUnitCost: number; laborUnitCost: number; expenseUnitCost: number;
  saleUnitPrice: number; priceCategory: typeof QUOTE_PRICE_CATEGORIES[number]; notes: string;
}
export interface QuoteSectionInput { kind: typeof QUOTE_SECTIONS[number]; items: QuoteItemInput[] }
export interface QuoteInput {
  groupComponents?: boolean;
  customerId: string; siteId: string | null; siteName: string; address: string; workContent: string;
  quoteDate: string; validUntil: string; status: typeof QUOTE_STATUSES[number]; notes: string;
  generalFee: number; supportFee: number; internalGeneralCost: number; internalSupportCost: number;
  rounding: '천원 반올림' | '반올림 없음'; displayUnit: '만원' | '원'; sections: QuoteSectionInput[];
}
export interface Quote extends QuoteInput { id: string; customerName: string; createdAt: string; updatedAt: string; convertedSiteId: string | null }
export interface QuotePublicTotals { material: number; labor: number; expense: number; generalFee: number; supportFee: number; adjustment: number; supplyAmount: number; vat: number; totalAmount: number; unroundedTotal: number }
export interface QuoteInternalTotals { material: number; labor: number; expense: number; general: number; support: number; totalCost: number; margin: number; marginRate: number }
export interface QuoteView extends Quote { totals: QuotePublicTotals; internal: QuoteInternalTotals }
// Explicit allowlist DTO. Customer export never accepts admin QuoteView.
export interface CustomerQuote {
  id: string; customerName: string; siteName: string; address: string; workContent: string;
  quoteDate: string; validUntil: string; notes: string; displayUnit: QuoteInput['displayUnit'];
  printMode: typeof QUOTE_PRINT_MODES[number]; totals: QuotePublicTotals;
  sections: { kind: typeof QUOTE_SECTIONS[number]; items: {trade:string;name:string;specification:string;quantity:number;unit:string;saleUnitPrice:number;amount:number;notes:string}[] }[];
}
// Thousandths quantities and integer won arithmetic; validate safe ranges at API boundary.
export const quoteLineAmount = (quantity: number, unitPrice: number) => {
  const amount = (BigInt(Math.round(quantity * 1000)) * BigInt(unitPrice) + 500n) / 1000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('견적 금액 범위를 초과했습니다.');
  return Number(amount);
};
export function calculateQuote(input: QuoteInput): { totals: QuotePublicTotals; internal: QuoteInternalTotals } {
  const sum = (values:number[]) => {const v=values.reduce((n,a)=>n+BigInt(a),0n);if(v>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('견적 합계 범위를 초과했습니다.');return Number(v);};
  const items=input.sections.flatMap(s=>s.items);
  const category=(key:typeof QUOTE_PRICE_CATEGORIES[number])=>sum(items.filter(i=>i.priceCategory===key).map(i=>quoteLineAmount(i.quantity,i.saleUnitPrice)));
  const material=category('재료비'),labor=category('노무비'),expense=category('경비');
  const originalSupply=sum([material,labor,expense,input.generalFee,input.supportFee]);
  const unroundedTotal=sum([originalSupply,Number((BigInt(originalSupply)+5n)/10n)]);
  const rounded=input.rounding==='천원 반올림' ? ((BigInt(unroundedTotal)+500n)/1000n)*1000n : BigInt(unroundedTotal);
  if(rounded>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('반올림 금액 범위를 초과했습니다.');
  const totalAmount=Number(rounded);
  const supplyAmount=input.rounding==='천원 반올림'? Number((rounded*10n+5n)/11n):originalSupply;
  const totals={material,labor,expense,generalFee:input.generalFee,supportFee:input.supportFee,adjustment:supplyAmount-originalSupply,supplyAmount,vat:totalAmount-supplyAmount,totalAmount,unroundedTotal};
  const costs=(key:'materialUnitCost'|'laborUnitCost'|'expenseUnitCost')=>sum(items.map(i=>quoteLineAmount(i.quantity,i[key])));
  const cm=costs('materialUnitCost'),cl=costs('laborUnitCost'),ce=costs('expenseUnitCost');
  const totalCost=sum([cm,cl,ce,input.internalGeneralCost,input.internalSupportCost]);
  const margin=supplyAmount-totalCost;
  return {totals,internal:{material:cm,labor:cl,expense:ce,general:input.internalGeneralCost,support:input.internalSupportCost,totalCost,margin,marginRate:supplyAmount ? margin/supplyAmount*100:0}};
}

// Application identity is separate from company branding and system memberships.
export const APP_BRAND = { name: '현장관리', provisional: true } as const;
export interface CompanyMembership { companyId: string; userId: string; role: 'admin' | 'member' | 'viewer' }
export interface CompanyUser { id: string; name: string; memberships: CompanyMembership[] }
export type CompanyOwned<T> = T & { companyId: string };
export interface Company {
  id: string; name: string; displayName: string; logoUrl: string | null; sealKey: string | null;
  phone: string; fax: string; email: string; address: string; branchAddress: string; website: string;
  business: BusinessParty & { corporationNumber: string };
  quoteTemplate: { id: string; storageKey: string; kind: 'jongno-2026' | 'custom' } | null;
  output: { photoReportTitle: string; footer: string; quoteNotes: string };
}
export const DEFAULT_COMPANY: Company = {
  id: 'jongno', name: '주식회사 종로소방', displayName: '종로소방', logoUrl: null, sealKey: 'companies/jongno/assets/seal',
  phone: '02-861-4119', fax: '02-2679-2006', email: 'jongro5119@naver.com', address: '서울시 영등포구 영신로 14-1', branchAddress: '경기도 고양시 덕양구 청초로 10, B-1108', website: 'www.jrsobang.com',
  business: { registrationNumber: '647-86-00929', corporationNumber: '110111-6738847', name: '주식회사 종로소방', representative: '강기현', address: '서울시 영등포구 영신로 14-1', businessType: '', businessItem: '', email: 'jongro5119@naver.com' },
  quoteTemplate: { id: 'jongno-2026', kind: 'jongno-2026', storageKey: 'companies/jongno/templates/jongno-2026.xlsx' },
  output: { photoReportTitle: '공사 사진대지', footer: '안전한 현장, 체계적인 관리', quoteNotes: '' },
};
export interface CompanyFileReference { companyId: string; storageKey: string; originalFilename: string; kind: 'photo' | 'receipt' | 'report' | 'logo' | 'seal' | 'quote-template' }
// Persistence contract: public DTOs stay compatible; company ownership is mandatory in stored models.
export interface CompanyDataModel {
  users: CompanyOwned<{userId:string; role:CompanyMembership['role']}>;
  customers: CompanyOwned<Customer>; sites: CompanyOwned<Site>; quotes: CompanyOwned<Quote>;
  quoteSections: CompanyOwned<QuoteSectionInput & {id:string; quoteId:string; position:number}>;
  quoteItems: CompanyOwned<QuoteItemInput & {id:string; sectionId:string; position:number}>;
  workers: CompanyOwned<Worker>; availability: CompanyOwned<WorkerAvailability & {workerId:string}>;
  dailyWork: CompanyOwned<DailyWorkRecord>; participants: CompanyOwned<DailyWorkParticipant>;
  photos: CompanyOwned<PhotoRecord>; materials: CompanyOwned<Material>; materialUsage: CompanyOwned<MaterialUsage>;
  expenses: CompanyOwned<ExpenseRecord>; materialPurchases: CompanyOwned<ExpenseLineItem>; settlementItems: CompanyOwned<WorkerSettlement>;
  receipts: CompanyOwned<PaymentReceived>; workerPayments: CompanyOwned<WorkerPayment>; allocations: CompanyOwned<WorkerPaymentAllocation>;
  salesInvoices: CompanyOwned<SalesInvoice>; purchaseInvoices: CompanyOwned<PurchaseInvoice>; workerInvoices: CompanyOwned<WorkerInvoice>;
  auditLogs: AuditLog;
  inspectionReports: InspectionReportRecord; inspectionItems: InspectionItemRecord; inspectionPhotoLinks: InspectionPhotoLink;
  files: CompanyFileReference; quoteTemplates: CompanyOwned<NonNullable<Company['quoteTemplate']>>;
}

export const AUDIT_ACTIONS = ['생성', '수정', '삭제', '복사', '계약전환', '비활성화', '상태변경', '추가', '순서변경', '등록', '지급취소', '다운로드'] as const;
export const AUDIT_TARGETS = ['현장', '견적', '작업진행자', '일일작업', '사용자재', '사진', '자재구매', '경비', '수금', '작업진행자 지급', '세금계산서', '증빙', '파일', '점검지적사항 보고서'] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];
export type AuditTarget = typeof AUDIT_TARGETS[number];
export type AuditValue = null | boolean | number | string | AuditValue[] | {[key:string]:AuditValue};
export interface AuditLog {
  id: string; companyId: string; userId: string; userDisplayName: string;
  targetType: AuditTarget; targetId: string; action: AuditAction;
  before: AuditValue; after: AuditValue; changedAt: string; sequence: number; reason: string;
  siteIds: string[]; sites: {id:string;name:string}[];
}
export interface AuditPage {
  items: AuditLog[]; total: number; page: number; pageSize: number;
  users: {id:string;name:string}[]; sites: {id:string;name:string}[];
}

export const COMPLETION_REPORT_TYPES = ['공사 완료보고서', '보수 완료보고서'] as const;
export interface CompletionDay { dailyWorkId: string; date: string; content: string }
export interface CompletionReportInput {
  documentType: typeof COMPLETION_REPORT_TYPES[number]; title: string; purpose: string;
  summary: string; periodStart: string; periodEnd: string; createdDate: string;
  managerId: string; participantIds: string[]; days: CompletionDay[];
  notes: string; opinion: string; followUp: string;
  photoType: '' | '작업 전' | '작업 후'; photoSelection: '전체 사진' | '선택한 사진만';
  photoIds: string[]; photoLayout: '사진 목록' | '사진대지';
}
export interface CompletionReportSource {
  site: Site; defaults: CompletionReportInput; materials: SiteMaterialTotal[];
  workers: {id: string; displayName: string}[]; photos: PhotoView[];
}

export const INSPECTION_REPORT_TITLE = '점검지적사항 보수결과보고서';
export const INSPECTION_COVER_TITLES = ['소방시설등의 자체점검 결과 이행완료 보고서', INSPECTION_REPORT_TITLE] as const;
export const INSPECTION_OUTPUT_MODES = ['이행완료 보고서 + 보수결과 + 사진대지', '보수결과 + 사진대지', '사진대지만'] as const;
export interface InspectionItemInput { id?: string; number: string; location?: string; photoContent?: string; inspection: string; result: string; beforePhotoIds: string[]; afterPhotoIds: string[] }
export interface InspectionReportInput { workDate: string; createdDate: string; originalDocumentName: string; layout: 6 | 8; outputMode?: typeof INSPECTION_OUTPUT_MODES[number]; coverTitle?: typeof INSPECTION_COVER_TITLES[number]; actionSummary?: string; items: InspectionItemInput[] }
export interface InspectionReportRecord extends Omit<InspectionReportInput, 'items'> { id: string; companyId: string; siteId: string; createdAt: string; updatedAt: string }
export interface InspectionItemRecord extends Omit<InspectionItemInput,'id'|'beforePhotoIds'|'afterPhotoIds'> { id: string; companyId: string; reportId: string; position: number }
export interface InspectionPhotoLink { companyId: string; itemId: string; photoId: string; stage: '작업 전' | '작업 후'; position: number }
export interface InspectionReport extends InspectionReportRecord { items: (InspectionItemInput & {id:string})[] }
export interface InspectionReportSource { site: Site; companyName: string; photos: PhotoView[]; defaults: InspectionReportInput; reports: InspectionReport[] }

export const WORK_COMPONENT_ROLES = ['주자재','부속자재','배선','배관','잡자재','철거노무','설치노무','결선노무','시험/시운전','기타'] as const;
export const WORK_QUANTITY_MODES = ['작업수량에 비례','고정수량','길이기준','1식','관리자 직접입력'] as const;
export const WORK_REUSE_FLAGS = ['기존 감지기 재사용','기존 발신기 재사용','기존 간선 활용','기존 배관 활용'] as const;
export interface WorkPrice { id: string; companyId: string; name: string; specification: string; unit: string; category: '재료비'|'노무비'|'경비'; cost: number; salePrice: number }
export interface WorkComponent { id: string; priceId: string; role: typeof WORK_COMPONENT_ROLES[number]; mode: typeof WORK_QUANTITY_MODES[number]; factor: number; lengthKey: '배선'|'배관'; omitWhen: typeof WORK_REUSE_FLAGS[number][]; customerGroup: string }
export interface StandardWork { priceSnapshot?: WorkPrice[]; id: string; companyId: string; name: string; section: '기계'|'전기'; version: number; components: WorkComponent[]; updatedAt: string; updatedBy: string; reason: string }
export interface StandardWorkRequest { quantity: number; lengths: { 배선: number; 배관: number }; reuse: typeof WORK_REUSE_FLAGS[number][]; overrides: Record<string, number> }

import { CompanyContext } from './company-context';
import { CUSTOMERS_REPOSITORY, CustomersRepository } from './customers.repository';
import { FinanceService, sum } from './finance.service';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SITE_STATUSES, SiteInput } from '@jongno/shared';
import { SitesRepository, SITES_REPOSITORY } from './sites.repository';
import { WorkersRepository, WORKERS_REPOSITORY } from './workers.repository';
import { overlapsMonth, validateMonth } from './date';
const textFields = ['name', 'client', 'address', 'contactName', 'phone', 'description', 'startDate', 'endDate'] as const;
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validateInput(body: unknown): SiteInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('현장 입력값이 필요합니다.');
  const raw = body as Record<string, unknown>;
  const input: Record<string, unknown> = {};
  for (const key of textFields) {
    const value = raw[key] ?? '';
    if (typeof value !== 'string' || value.length > (key === 'description' ? 5000 : 300)) throw new BadRequestException(`${key} 입력값을 확인해 주세요.`);
    input[key] = value.trim();
  }
  if (!input.name) throw new BadRequestException('현장명은 필수입니다.');
  if (!validDate(input.startDate as string)) throw new BadRequestException('시작일은 유효한 날짜여야 합니다.');
  if (input.endDate && (!validDate(input.endDate as string) || (input.endDate as string) < (input.startDate as string))) throw new BadRequestException('종료예정일은 시작일 이후여야 합니다.');
  if (typeof raw.contractAmount !== 'number' || !Number.isSafeInteger(raw.contractAmount) || raw.contractAmount < 0) throw new BadRequestException('공사금액은 0 이상의 안전한 정수여야 합니다.');
  if (!SITE_STATUSES.includes(raw.status as SiteInput['status'])) throw new BadRequestException('진행상태를 확인해 주세요.');
  if (raw.manager != null && (typeof raw.manager !== 'string' || raw.manager.length > 300)) throw new BadRequestException('대표 작업진행자를 확인해 주세요.');
  return { ...input, contractAmount: raw.contractAmount, manager: typeof raw.manager === 'string' ? raw.manager.trim() || null : null, status: raw.status } as SiteInput;
}
@Injectable()
export class SitesService {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService, @Inject(SITES_REPOSITORY) private readonly repository: SitesRepository, @Inject(WORKERS_REPOSITORY) private readonly workers: WorkersRepository, @Inject(CUSTOMERS_REPOSITORY) private readonly customers: CustomersRepository, @Inject(CompanyContext) private readonly company:CompanyContext) {}
  list(month?: string) { if (month !== undefined) validateMonth(month); return this.repository.list().filter(s => !s.deletedAt && (month === undefined || overlapsMonth(s, month))).map(s=>this.view(s)); }
  find(id: string) { const site = this.repository.find(id); if (!site || site.deletedAt) throw new NotFoundException('현장을 찾을 수 없습니다.'); return this.view(site); }
  private view(site: import('@jongno/shared').Site){const f=this.finance.siteFinance(site.id);return {...site,collectedAmount:f.collectedAmount,unpaidWorkerAmount:f.unpaidWorkerAmount};}
  private linkedInput(body: unknown, existing?: import('@jongno/shared').Site): SiteInput {
    const value = validateInput(body);
    sum([...this.repository.list().filter(s=>s.id!==existing?.id).map(s=>s.contractAmount),value.contractAmount]);
    const raw = body as Record<string, unknown>;
    const clientId = raw.clientId === undefined ? (existing?.client === value.client ? existing?.clientId ?? null : null) : raw.clientId;
    if (clientId !== null && (typeof clientId !== 'string' || !this.customers.find(clientId))) throw new BadRequestException('거래처 연결을 확인해 주세요.');
    value.clientId = clientId as string | null;
    const trades = raw.trades === undefined ? existing?.trades ?? [] : raw.trades;
    if (!Array.isArray(trades) || trades.some(t=>!['기계','전기'].includes(t)) || new Set(trades).size!==trades.length) throw new BadRequestException('공종을 확인해 주세요.');
    value.trades = [...trades] as ('기계'|'전기')[];
    const tradeNames = raw.tradeNames === undefined ? existing?.tradeNames ?? [] : raw.tradeNames;
    if (!Array.isArray(tradeNames) || tradeNames.length>200 || tradeNames.some(t=>typeof t!=='string'||!t.trim()||t.length>100) || new Set(tradeNames).size!==tradeNames.length) throw new BadRequestException('세부 공종을 확인해 주세요.');
    value.tradeNames = [...tradeNames];
    // Older records retain their label until explicitly reassigned.
    const id = raw.managerId === undefined ? existing?.managerId ?? null : raw.managerId;
    if (id !== null && typeof id !== 'string') throw new BadRequestException('대표 작업진행자 ID를 확인해 주세요.');
    if (!id) return { ...value, managerId: null, manager: existing && raw.managerId === undefined ? existing.manager : null };
    const worker = this.workers.find(id);
    if (!worker) throw new BadRequestException('작업진행자를 찾을 수 없습니다.');
    if (existing?.managerId === id) return { ...value, managerId: id, manager: existing.manager };
    if (worker.deletedAt) throw new BadRequestException('삭제된 작업진행자는 새로 배정할 수 없습니다.');
    return { ...value, managerId: id, manager: worker.displayName };
  }
  create(body: unknown) { return this.view(this.repository.create(this.linkedInput(body))); }
  update(id: string, body: unknown) {
    const existing = this.find(id);
    const site = this.repository.update(id, this.linkedInput(body, existing));
    if (!site) throw new NotFoundException('현장을 찾을 수 없습니다.');
    return this.view(site);
  }
  archive(id:string) {
    this.company.assertMember(true);this.find(id);
    this.repository.archive(id);return {deleted:true};
  }

}

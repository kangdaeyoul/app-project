import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SITE_STATUSES, SiteInput } from '@jongno/shared';
import { SitesRepository, SITES_REPOSITORY } from './sites.repository';
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
  constructor(@Inject(SITES_REPOSITORY) private readonly repository: SitesRepository) {}
  list(month?: string) { if (month !== undefined) validateMonth(month); return this.repository.list().filter(s => month === undefined || overlapsMonth(s, month)); }
  find(id: string) { const site = this.repository.find(id); if (!site) throw new NotFoundException('현장을 찾을 수 없습니다.'); return site; }
  create(body: unknown) { return this.repository.create(validateInput(body)); }
  update(id: string, body: unknown) {
    this.find(id);
    const site = this.repository.update(id, validateInput(body));
    if (!site) throw new NotFoundException('현장을 찾을 수 없습니다.');
    return site;
  }
}

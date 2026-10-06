import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Dashboard } from '@jongno/shared';
import { SITES_REPOSITORY, SitesRepository } from './sites.repository';
export function seoulToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
@Injectable()
export class DashboardService {
  constructor(@Inject(SITES_REPOSITORY) private readonly repository: SitesRepository) {}
  get(month?: string): Dashboard {
    const today = seoulToday();
    const selected = month ?? today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) || selected.startsWith('0000')) throw new BadRequestException('month는 YYYY-MM 형식이어야 합니다.');
    const sampleDay = selected === today.slice(0, 7) ? today : selected + '-06';
    const sites = this.repository.list(selected, sampleDay);
    const sum = (key: 'contractAmount' | 'collectedAmount' | 'unpaidWorkerAmount') => sites.reduce((total, site) => total + site[key], 0);
    return { month: selected, today, sites, summary: {
      todaySites: sites.filter(s => s.date === today).length,
      inProgress: sites.filter(s => s.status === '진행중').length,
      completed: sites.filter(s => s.status === '완료').length,
      unassigned: sites.filter(s => s.status === '미배정').length,
      contractRevenue: sum('contractAmount'), collected: sum('collectedAmount'),
      receivables: sum('contractAmount') - sum('collectedAmount'), unpaidWorkers: sum('unpaidWorkerAmount'),
    } };
  }
}

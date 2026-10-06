import { Inject, Injectable } from '@nestjs/common';
import { Dashboard, isSiteOnDate } from '@jongno/shared';
import { SITES_REPOSITORY, SitesRepository } from './sites.repository';
import { overlapsMonth, seoulToday, validateMonth } from './date';
export { seoulToday } from './date';
@Injectable()
export class DashboardService {
  constructor(@Inject(SITES_REPOSITORY) private readonly repository: SitesRepository) {}
  get(month?: string): Dashboard {
    const today = seoulToday();
    const selected = validateMonth(month ?? today.slice(0, 7));
    const sites = this.repository.list().filter(s => overlapsMonth(s, selected));
    const sum = (key: 'contractAmount' | 'collectedAmount' | 'unpaidWorkerAmount') => sites.reduce((total, site) => total + site[key], 0);
    return { month: selected, today, sites, summary: {
      todaySites: sites.filter(s => isSiteOnDate(s, today)).length,
      inProgress: sites.filter(s => s.status === '진행중').length,
      completed: sites.filter(s => s.status === '완료').length,
      unassigned: sites.filter(s => s.status === '미배정').length,
      contractRevenue: sum('contractAmount'), collected: sum('collectedAmount'),
      receivables: sum('contractAmount') - sum('collectedAmount'), unpaidWorkers: sum('unpaidWorkerAmount'),
    } };
  }
}

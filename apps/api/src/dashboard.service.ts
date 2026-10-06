import { FinanceService, sum as sumMoney } from './finance.service';
import { Inject, Injectable } from '@nestjs/common';
import { Dashboard, isSiteOnDate } from '@jongno/shared';
import { SITES_REPOSITORY, SitesRepository } from './sites.repository';
import { overlapsMonth, seoulToday, validateMonth } from './date';
export { seoulToday } from './date';
@Injectable()
export class DashboardService {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService, @Inject(SITES_REPOSITORY) private readonly repository: SitesRepository) {}
  get(month?: string): Dashboard {
    const today = seoulToday();
    const selected = validateMonth(month ?? today.slice(0, 7));
    const rawSites = this.repository.list().filter(s => overlapsMonth(s, selected));
    const financials=rawSites.map(s=>this.finance.siteFinance(s.id));
    const sites=rawSites.map((s,i)=>({...s,collectedAmount:financials[i].collectedAmount,unpaidWorkerAmount:financials[i].unpaidWorkerAmount}));
    const sum = (key: 'contractAmount' | 'collectedAmount' | 'unpaidWorkerAmount') => sumMoney(sites.map(site=>site[key]));
    return { month: selected, today, sites, summary: {
      todaySites: sites.filter(s => isSiteOnDate(s, today)).length,
      inProgress: sites.filter(s => s.status === '진행중').length,
      completed: sites.filter(s => s.status === '완료').length,
      unassigned: sites.filter(s => s.status === '미배정').length,
      contractRevenue: sum('contractAmount'), collected: sum('collectedAmount'),
      receivables: sum('contractAmount') - sum('collectedAmount'), unpaidWorkers: sum('unpaidWorkerAmount'), totalExpenses: sumMoney(financials.map(f=>f.totalExpenses)), siteProfit:sumMoney(financials.map(f=>f.siteProfit)),
    } };
  }
}

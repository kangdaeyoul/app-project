import { randomUUID } from 'node:crypto';
import { Site, SiteInput } from '@jongno/shared';
import { seoulToday } from './date';
export const SITES_REPOSITORY = Symbol('SITES_REPOSITORY');
export interface SitesRepository {
  list(): Site[];
  find(id: string): Site | undefined;
  create(input: SiteInput): Site;
  update(id: string, input: SiteInput): Site | undefined;
  archive(id:string): Site | undefined;
}
// Process-local adapter: restart restores samples. Replace via DI for PostgreSQL.
export class SampleSitesRepository implements SitesRepository {
  private readonly sites: Site[];
  constructor(today = seoulToday(), seed = true) {
    if (!seed) { this.sites = []; return; }
    const month = today.slice(0, 7);
    const entries = [
      { id: 'S001', name: '종로 오피스 소방시설 개선', client: '종로 오피스', address: '종로구 종로 33', startDate: today, endDate: today, status: '진행중', manager: '김현장 소장', managerId: 'W001', contractAmount: 24000000, collectedAmount: 0, unpaidWorkerAmount: 0 },
      { id: 'S002', name: '혜화 상가 감지기 교체', client: '혜화 상가 관리사무소', address: '종로구 대학로 120', startDate: today, endDate: today, status: '미배정', manager: null, managerId: null, contractAmount: 5500000, collectedAmount: 0, unpaidWorkerAmount: 0 },
      { id: 'S003', name: '광화문 빌딩 정기 점검', client: '광화문 빌딩', address: '종로구 세종대로 175', startDate: month + '-05', endDate: month + '-05', status: '완료', manager: '박진행 팀장', managerId: 'W002', contractAmount: 12000000, collectedAmount: 0, unpaidWorkerAmount: 0 },
      { id: 'S004', name: '창신동 공동주택 배관 공사', client: '창신 공동주택', address: '종로구 창신길 62', startDate: month + '-18', endDate: month + '-20', status: '진행중', manager: '이소방 기사', managerId: 'W003', contractAmount: 32000000, collectedAmount: 0, unpaidWorkerAmount: 0 },
      { id: 'S005', name: '익선동 매장 소화설비 설치', client: '익선 매장', address: '종로구 수표로 28길', startDate: month + '-24', endDate: month + '-24', status: '미배정', manager: null, managerId: null, contractAmount: 6500000, collectedAmount: 0, unpaidWorkerAmount: 0 },
    ];
    this.sites = entries.map(s => ({ ...s, status: s.status as Site['status'], trades: (s.id === 'S002' ? ['전기'] : ['기계','전기']) as Site['trades'], contactName: '현장 담당자', phone: '02-000-0000', description: s.name }));
  }
  list() { return this.sites.map(s => structuredClone(s)); }
  find(id: string) { const site = this.sites.find(s => s.id === id); return site && structuredClone(site); }
  create(input: SiteInput) {
    const site = { ...input, id: randomUUID(), collectedAmount: 0, unpaidWorkerAmount: 0 };
    this.sites.push(structuredClone(site)); return structuredClone(site);
  }
  update(id: string, input: SiteInput) {
    const index = this.sites.findIndex(s => s.id === id);
    if (index < 0) return undefined;
    this.sites[index] = { ...this.sites[index], ...structuredClone(input) };
    return structuredClone(this.sites[index]);
  }
  archive(id:string) {
    const site=this.sites.find(s=>s.id===id);if(!site)return undefined;
    site.deletedAt ??= new Date().toISOString();return structuredClone(site);
  }

}

import { Site } from '@jongno/shared';
export const SITES_REPOSITORY = Symbol('SITES_REPOSITORY');
export interface SitesRepository { list(month: string, today: string): Site[] }
// Replace this adapter with a PostgreSQL implementation later.
export class SampleSitesRepository implements SitesRepository {
  list(month: string, today: string): Site[] {
    return [
      { id: 'S001', name: '종로 오피스 소방시설 개선', address: '종로구 종로 33', date: today, status: '진행중', manager: '김현장', contractAmount: 24000000, collectedAmount: 12000000, unpaidWorkerAmount: 1800000 },
      { id: 'S002', name: '혜화 상가 감지기 교체', address: '종로구 대학로 120', date: today, status: '미배정', manager: null, contractAmount: 8500000, collectedAmount: 2500000, unpaidWorkerAmount: 0 },
      { id: 'S003', name: '광화문 빌딩 정기 점검', address: '종로구 세종대로 175', date: month + '-05', status: '완료', manager: '박진행', contractAmount: 12000000, collectedAmount: 12000000, unpaidWorkerAmount: 650000 },
      { id: 'S004', name: '창신동 공동주택 배관 공사', address: '종로구 창신길 62', date: month + '-18', status: '진행중', manager: '이소방', contractAmount: 32000000, collectedAmount: 10000000, unpaidWorkerAmount: 2400000 },
      { id: 'S005', name: '익선동 매장 소화설비 설치', address: '종로구 수표로 28길', date: month + '-24', status: '미배정', manager: null, contractAmount: 6500000, collectedAmount: 0, unpaidWorkerAmount: 0 },
    ];
  }
}

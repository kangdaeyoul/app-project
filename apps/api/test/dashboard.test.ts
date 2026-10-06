import { FinanceService } from '../src/finance.service';
import { SampleFinanceRepository } from '../src/finance.repository';
import { SampleExpensesRepository } from '../src/expenses.repository';
import { SampleWorkersRepository } from '../src/workers.repository';
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DashboardService, seoulToday } from '../src/dashboard.service';
import { SampleSitesRepository } from '../src/sites.repository';
test('서울 시간은 UTC 날짜 경계를 정확히 처리한다', () => {
  assert.equal(seoulToday(new Date('2026-10-05T15:00:00Z')), '2026-10-06');
});
test('월별 합계와 배정 상태는 샘플 현장과 일치한다', () => {
  const sites=new SampleSitesRepository('2026-10-06');
  const finance=new FinanceService(new SampleFinanceRepository('2026-10-06'), new SampleExpensesRepository(),sites,new SampleWorkersRepository('2026-10-06'));
  const dashboard = new DashboardService(finance, sites).get('2026-10');
  assert.equal(dashboard.sites.length, 5);
  assert.equal(dashboard.summary.contractRevenue, 80000000);
  assert.equal(dashboard.summary.collected, 38000000);
  assert.equal(dashboard.summary.receivables, 42000000);
  assert.equal(dashboard.summary.unpaidWorkers, 2047000);
  assert.equal(dashboard.summary.unassigned, 2);
  assert.equal(dashboard.summary.inProgress, 2);
  assert.equal(dashboard.summary.completed, 1);
  assert.ok(dashboard.sites.every(s => s.startDate.startsWith('2026-10')));
});
test('HTTP API는 상태, 월 조회, 잘못된 월의 400 응답을 제공한다', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api'); await app.init();
  try {
    await request(app.getHttpServer()).get('/api/health').expect(200).expect({status:'ok',mode:'sample'});
    const res = await request(app.getHttpServer()).get('/api/dashboard?month=2026-02').expect(200);
    assert.equal(res.body.month, '2026-02');
    assert.equal(res.body.sites.length, 0);
    await request(app.getHttpServer()).get('/api/dashboard?month=2026-13').expect(400);
    await request(app.getHttpServer()).get('/api/dashboard?month=invalid').expect(400);
    const sites = await request(app.getHttpServer()).get('/api/sites?month=2026-02').expect(200);
    assert.equal(sites.body.length, 0);
  } finally { await app.close(); }
});

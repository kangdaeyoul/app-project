import { createTestApp } from "./test-app";
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { seoulToday } from '../src/date';
import { SampleSitesRepository } from '../src/sites.repository';

test('현장 등록·조회·수정과 대시보드가 같은 저장소를 사용한다', async () => {
  const app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix('api'); await app.init();
  const http = app.getHttpServer();
  const today = seoulToday();
  const month = today.slice(0, 7);
  try {
    const before = (await request(http).get(`/api/dashboard?month=${month}`).expect(200)).body;
    const input = { name: '신규 현장', client: '테스트 거래처', startDate: today, endDate: today, contractAmount: 1000000, status: '미배정' };
    const created = (await request(http).post('/api/sites').send(input).expect(201)).body;
    assert.ok(created.id);
    assert.equal(created.collectedAmount, 0);
    assert.equal(created.manager, null);
    assert.equal(created.address, '');
    assert.equal((await request(http).get(`/api/sites/${created.id}`).expect(200)).body.client, input.client);
    const list = (await request(http).get('/api/sites').expect(200)).body;
    assert.equal(list.length, 6);
    const after = (await request(http).get(`/api/dashboard?month=${month}`).expect(200)).body;
    assert.equal(after.summary.todaySites, before.summary.todaySites + 1);
    assert.equal(after.summary.contractRevenue, before.summary.contractRevenue + 1000000);
    assert.equal(after.summary.receivables, before.summary.receivables + 1000000);
    assert.equal(after.sites.find((s: { id: string }) => s.id === created.id).name, '신규 현장');
    const changed = { ...created, name: '수정 현장', manager: '김작업', status: '완료', collectedAmount: 999999, id: 'forged' };
    const updated = (await request(http).put(`/api/sites/${created.id}`).send(changed).expect(200)).body;
    assert.equal(updated.id, created.id);
    assert.equal(updated.name, '수정 현장');
    assert.equal(updated.collectedAmount, 0);
    const final = (await request(http).get(`/api/dashboard?month=${month}`).expect(200)).body;
    assert.equal(final.summary.completed, before.summary.completed + 1);
    assert.equal(final.summary.unassigned, before.summary.unassigned);
    const moved = { ...updated, startDate: '2035-12-30', endDate: '2036-01-02' };
    await request(http).put(`/api/sites/${created.id}`).send(moved).expect(200);
    assert.equal((await request(http).get('/api/dashboard?month=2035-12').expect(200)).body.sites.length, 1);
    assert.equal((await request(http).get('/api/dashboard?month=2036-01').expect(200)).body.sites.length, 1);
    assert.equal((await request(http).get(`/api/dashboard?month=${month}`).expect(200)).body.sites.length, 5);
    const existing = (await request(http).get('/api/sites/S001').expect(200)).body;
    await request(http).put('/api/sites/S001').send({ ...existing, name: '기존 현장 수정', collectedAmount: 0 }).expect(200);
    const preserved = (await request(http).get('/api/sites/S001').expect(200)).body;
    assert.equal(preserved.collectedAmount, 12000000);
    assert.equal(preserved.unpaidWorkerAmount, 537000);
  } finally { await app.close(); }
});

test('잘못된 날짜·금액·상태는 거부하며 누락 현장은 404이다', async () => {
  const app = await createTestApp(AppModule, { logger: false });
  app.setGlobalPrefix('api'); await app.init();
  const http = app.getHttpServer();
  const input = { name: '검증', startDate: '2026-10-06', contractAmount: 0, status: '미배정' };
  try {
    for (const invalid of [
      { name: '' }, { name: '  ' }, { startDate: '2026-02-30' }, { startDate: '2026-13-01' },
      { endDate: '2026-10-05' }, { contractAmount: -1 }, { contractAmount: 0.5 },
      { contractAmount: Number.MAX_SAFE_INTEGER + 1 }, { contractAmount: '10' }, { status: 'invalid' }, { manager: 42 },
    ]) await request(http).post('/api/sites').send({ ...input, ...invalid }).expect(400);
    await request(http).get('/api/sites?month=invalid').expect(400);
    await request(http).get('/api/sites/missing').expect(404);
    await request(http).put('/api/sites/missing').send(input).expect(404);
    await request(http).put('/api/sites/S001').send({ ...input, startDate: 'invalid' }).expect(400);
    assert.equal((await request(http).get('/api/sites').expect(200)).body.length, 5);
  } finally { await app.close(); }
});

test('샘플은 월 조회마다 재생성되지 않고 반환값 변경도 저장소를 손상시키지 않는다', () => {
  const repository = new SampleSitesRepository('2026-10-06');
  const first = repository.list(); first[0].name = '외부 변경';
  assert.notEqual(repository.find('S001')?.name, '외부 변경');
  const renewed = new SampleSitesRepository('2026-10-06');
  assert.equal(renewed.list().length, 5);
});

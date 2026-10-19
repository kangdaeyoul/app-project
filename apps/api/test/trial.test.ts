import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { TrialService } from '../src/trial';
import { AppModule } from '../src/app.module';
import { CompanyContext } from '../src/company-context';
import { SITES_REPOSITORY, SitesRepository } from '../src/sites.repository';
import { MaterialPersistence } from '../src/material-persistence';
import { DEFAULT_COMPANY } from '@jongro/shared';
import { fixture } from './supabase-fixture';

test('운영 체험: 개발 데모 비활성, 방문자별 격리·수정·출력·초기화·재생성·종료·만료',async()=>{
 const prior={NODE_ENV:process.env.NODE_ENV,APP_ENV:process.env.APP_ENV,DEMO_LOGIN_ENABLED:process.env.DEMO_LOGIN_ENABLED};
 process.env.NODE_ENV='production';process.env.APP_ENV='production';process.env.DEMO_LOGIN_ENABLED='false';
 const app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api');await app.init();
 const http=app.getHttpServer();
 const call=(cookie:string)=>({get:(url:string)=>request(http).get('/api'+url).set('Cookie',cookie),post:(url:string,body:any={})=>request(http).post('/api'+url).set('Cookie',cookie).send(body),put:(url:string,body:any)=>request(http).put('/api'+url).set('Cookie',cookie).send(body)});
 async function start(role='admin') {const r=await request(http).post('/api/trial/start').send({role}).expect(201);const cookie=(r.headers['set-cookie'] as unknown as string[]).find(c=>c.startsWith('field_trial=')&&c.includes('Max-Age'))!;assert(cookie.includes('HttpOnly')&&cookie.includes('Secure')&&cookie.includes('SameSite=Lax'));assert(!cookie.includes('field_session'));return cookie.split(';')[0];}
 try{
  const config=(await request(http).get('/api/auth/config')).body;assert.equal(config.authMode,'supabase');assert.equal(config.demoEnabled,false);assert.equal(config.trialEnabled,true);
  await request(http).post('/api/auth/demo').send({account:'admin'}).expect(401);
  await request(http).get('/api/sites').expect(401);
  await request(http).post('/api/trial/start').set('Origin','https://foreign.test').send({role:'admin'}).expect(403);
  await request(http).post('/api/trial/start').send({role:'admin',companyId:'jongro'}).expect(400);
  const ac=await start(),bc=await start(),a=call(ac),b=call(bc);
  const me=(await a.get('/auth/me').expect(200)).body;assert.equal(me.authMode,'trial');assert(me.user.companyId.startsWith('trial_'));assert.notEqual(me.user.companyId,(await b.get('/auth/me')).body.user.companyId);
  assert.throws(()=>app.get(TrialService).resolve({method:'POST',headers:{cookie:ac,'content-length':'2097153'}} as any),/2MB/);
  assert.throws(()=>app.get(TrialService).resolve({method:'POST',headers:{cookie:ac}} as any),/크기/);
  const original=(await a.get('/sites/S001').expect(200)).body;
  const context=app.get(CompanyContext), repo=app.get<SitesRepository>(SITES_REPOSITORY);
  context.register({...structuredClone(DEFAULT_COMPANY),id:'real_company'});
  const real={authenticated:true,companyId:'real_company',userId:'actual',appRole:'admin' as const,memberships:[{companyId:'real_company',userId:'actual',role:'admin' as const}]};
  const realSite=context.run(real,()=>repo.create({...original,name:'PRIVATE COMPANY SITE'}));
  await a.get('/sites/'+realSite.id).expect(404);
  await a.put('/sites/S001',{...original,name:'체험 수정'}).expect(200);
  assert.equal((await a.get('/sites/S001')).body.name,'체험 수정');assert.equal((await b.get('/sites/S001')).body.name,original.name);
  assert.equal(context.run(real,()=>repo.find(realSite.id)!.name),'PRIVATE COMPANY SITE');
  await request(http).get('/api/sites').set('Cookie',ac).set('x-company-id','real_company').expect(403);
  await a.put('/sites/S001',{...original,companyId:'real_company'}).expect(403);
  await a.get('/users').expect(403);await a.put('/auth/profile',{name:'actual'}).expect(403);
  for(const path of ['/quotes','/daily-work','/workers','/photos','/settlements','/after-service','/sites/S001/completion-reports/source'])await a.get(path).expect(200);
  assert((await a.get('/after-service')).body.length>0);
  const catalog=(await a.get('/material-prices/catalog').expect(200)).body;assert(catalog.prices.length>0);assert(catalog.prices.every((p:any)=>p.companyId===me.user.companyId));
  await a.get('/quotes/Q001/pdf').expect(200).expect('Content-Type',/application\/pdf/);
  await a.get('/quotes/Q001/excel').expect(200).expect('Content-Type',/spreadsheet/);
  await a.get('/photos/P001/file').expect(200);
  await a.post('/tutorial/samples').expect(201);await a.get('/tutorial/progress').expect(200);
  await a.post('/trial/reset',{seed:false}).expect(201);assert.equal((await a.get('/sites')).body.length,0);assert.equal((await a.get('/quotes')).body.length,0);assert.equal((await a.get('/material-prices/catalog')).body.prices.length,0);assert.equal((await a.get('/after-service')).body.length,0);
  await a.post('/trial/reset',{seed:true}).expect(201);assert.equal((await a.get('/sites/S001')).body.name,original.name);
  await a.post('/trial/end').expect(201);await a.get('/sites').expect(401);assert.equal((await b.get('/sites/S001')).body.name,original.name);
  // Expiry is enforced server-side even if a cookie is manually retained.
  const now=Date.now;try{Date.now=()=>now()+3*60*60*1000;await b.get('/sites').expect(401);}finally{Date.now=now;}
  assert.throws(()=>context.run({...real,companyId:me.user.companyId,memberships:[{companyId:me.user.companyId,userId:'actual',role:'admin'}]},()=>repo.list()));
 }finally{await app.close();for(const [k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('체험 역할별 권한 및 실제 Supabase 세션 우선·승격 금지',async()=>{
 const f=await fixture();try{
  const http=f.a.getHttpServer();
  for(const role of ['staff','worker']){
   const agent=request.agent(http);await agent.post('/api/trial/start').send({role}).expect(201);
   const me=(await agent.get('/api/auth/me').expect(200)).body;assert.equal(me.user.role,role);assert.equal(me.user.authSource,'trial');
   await agent.get('/api/operational/sites').expect(200);await agent.get('/api/tutorial/progress').expect(200);
   await agent.get('/api/users').expect(403);await agent.get('/api/settlements').expect(403);
   if(role==='worker')await agent.get('/api/quotes').expect(403);
   else await agent.get('/api/quotes').expect(200);
   const login=await agent.post('/api/auth/login').send({login:'member@example.test',password:'Fixture123!'}).expect(201);
   assert((login.headers['set-cookie'] as unknown as string[]).some(c=>c.startsWith('field_trial=;')));
   const actual=(await agent.get('/api/auth/me').expect(200)).body;assert.equal(actual.access,'pending');assert.equal(actual.user,null);
   await agent.post('/api/trial/start').send({role:'admin'}).expect(403);await agent.post('/api/trial/reset').send({seed:true}).expect(403);await agent.get('/api/sites').expect(403);
  }
  // Even a mistakenly assigned real membership cannot enter reserved tenants.
  const actual=request.agent(http);await actual.post('/api/auth/login').send({login:'admin@example.test',password:'Fixture123!'});await actual.get('/api/auth/me');
  Object.assign(f.rows.get('10000000-0000-4000-8000-000000000002'),{company_id:'trial_forged',role:'admin',active:true,approval_status:'approved'});
  await actual.get('/api/sites').expect(403);
 }finally{await f.close();}
});

test('체험 자재는 PostgreSQL/SQLite 영구 저장소 트랜잭션을 호출하지 않는다',async()=>{
 const context=new CompanyContext();context.registerTrial({...structuredClone(DEFAULT_COMPANY),id:'trial_material_test'},true);
 const store=new MaterialPersistence(context);let calls=0;(store as any).database={transaction(){calls++;throw Error('must not enter real DB');}};
 try{await context.run({trial:true,authenticated:true,appRole:'admin',companyId:'trial_material_test',userId:'trial',memberships:[{companyId:'trial_material_test',userId:'trial',role:'admin'}]},()=>store.run(async()=>{assert(store.repository.list().prices.length>0);}));assert.equal(calls,0);}finally{(store as any).database=undefined;}
});

test('승인 DB 제약조건은 실제 사용자의 체험 회사 배정을 SQL/RLS 아래에서도 거부한다',async()=>{
 const db=new PGlite();try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to authenticated;`);
  for(const file of ['002-supabase-auth.sql','003-trial-isolation.sql','003-trial-isolation.sql'])await db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const id='10000000-0000-4000-8000-000000000001';await db.query('insert into auth.users values($1)',[id]);
  await assert.rejects(db.query("insert into public.app_memberships(user_id,company_id,role,approval_status,active) values($1,'trial_reserved','admin','approved',true)",[id]),/app_memberships_no_trial_company/);
  await db.query('insert into public.app_memberships(user_id) values($1)',[id]);
  await assert.rejects(db.query("update public.app_memberships set company_id='trial_reserved' where user_id=$1",[id]),/app_memberships_no_trial_company/);
 }finally{await db.close();}
});

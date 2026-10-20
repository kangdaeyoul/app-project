import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {fixture} from './supabase-fixture';
import {SupabaseAuthService} from '../src/supabase-auth';
const memberId='10000000-0000-4000-8000-000000000001',adminId='10000000-0000-4000-8000-000000000002',googleId='10000000-0000-4000-8000-000000000003';
async function adminLogin(f:Awaited<ReturnType<typeof fixture>>){
 const a=request.agent(f.a.getHttpServer());await a.post('/api/auth/login').send({login:'admin@example.test',password:'Fixture123!'}).expect(201);await a.get('/api/auth/me').expect(200);Object.assign(f.rows.get(adminId),{company_id:'jongro',role:'admin',approval_status:'approved',active:true});return a;
}
test('가입 승인 요청: 회사/역할 검증, 승인 후 즉시 접근, 거절 시 Auth 보존, 중복 처리 차단',async()=>{
 const f=await fixture();try{
  f.people.set('googleApplicant',{id:googleId,email:'google@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-10-19T00:00:00Z',user_metadata:{display_name:'Google 신청자',requested_company:'예시 신청 회사'},identities:[{id:'google',user_id:googleId,provider:'google'}]});
  const member=request.agent(f.a.getHttpServer()),google=request.agent(f.a.getHttpServer());
  for(const [a,email]of [[member,'member@example.test'],[google,'google@example.test']] as const){await a.post('/api/auth/login').send({login:email,password:'Fixture123!'});await a.get('/api/auth/me').expect(200);}
  await member.post('/api/users/'+memberId+'/approval').send({action:'approve'}).expect(403);
  const admin=await adminLogin(f);assert.equal((await admin.get('/api/users/pending-count').expect(200)).body.count,2);
  const list=(await admin.get('/api/users').expect(200)).body;
  assert.deepEqual(list.find((r:any)=>r.id===googleId).authProviders,['google']);assert.equal(list.find((r:any)=>r.id===googleId).appliedAt,'2026-10-19T00:00:00Z');
  const approval={action:'approve',companyId:'jongro',role:'staff',siteIds:['S001'],permissions:['writeQuotes']};
  await admin.post('/api/users/'+memberId+'/approval').send({...approval,companyId:'other'}).expect(403);
  await admin.post('/api/users/'+memberId+'/approval').send({...approval,role:'worker',workerId:null,permissions:[]}).expect(400);
  await admin.post('/api/users/'+memberId+'/approval').send({...approval,active:false}).expect(400);
  await admin.post('/api/users/'+memberId+'/approval').send(approval).expect(201);
  const m=f.rows.get(memberId);assert.equal(m.approval_status,'approved');assert.equal(m.active,true);assert.equal(m.company_id,'jongro');assert.equal(m.role,'staff');assert.equal(m.display_name,'신규 사용자');
  assert.equal((await member.get('/api/auth/me').expect(200)).body.access,'approved');await member.get('/api/operational/sites').expect(200);await member.get('/api/users/pending-count').expect(403);
  await admin.post('/api/users/'+memberId+'/approval').send({action:'reject'}).expect(400);assert.equal(m.approval_status,'approved');
  await admin.post('/api/users/'+googleId+'/approval').send({action:'reject'}).expect(201);
  assert.equal(f.rows.get(googleId).approval_status,'rejected');assert.equal(f.rows.get(googleId).active,false);assert(f.people.has('googleApplicant'));
  assert.equal((await google.get('/api/auth/me').expect(200)).body.access,'blocked');await google.get('/api/sites').expect(403);
  assert.equal((await admin.get('/api/users/pending-count')).body.count,0);assert.equal((await admin.get('/api/auth/me')).body.user.role,'admin');
  f.setProviderRpcAvailable(false);const fallback=(await admin.get('/api/users').expect(200)).body;assert.equal(fallback.find((u:any)=>u.id===googleId).authProviders.length,0);
 }finally{await f.close();}
});
test('Google 수동 계정 연결 오류는 한국어 안내·원인 로그를 제공하고 세션을 보존한다',async()=>{
 const f=await fixture();try{
  const a=request.agent(f.a.getHttpServer());await a.post('/api/auth/login').send({login:'member@example.test',password:'Fixture123!'});
  f.setLinkError({code:'manual_linking_disabled',msg:'Manual linking is disabled'});
  const logs:string[]=[];(f.a.get(SupabaseAuthService) as any).logger.error=(value:string)=>logs.push(value);
  const r=await a.post('/api/auth/link/google?response=json').expect(400);assert.match(r.body.message,/수동 계정 연결/);assert.match(r.body.message,/기존 로그인/);assert.match(logs[0],/manual_linking_disabled/);assert.match(logs[0],/Manual linking is disabled/);assert(!logs[0].includes('access_token'));
  assert.equal((await a.get('/api/auth/me').expect(200)).body.access,'pending');
  f.setLinkError(null);const success=await a.post('/api/auth/link/google?response=json').expect(201);assert.match(success.body.url,/accounts.google.com/);
 }finally{await f.close();}
});
test('제공자 조회 SQL: 자기 회사와 미배정 신청자만, 일반 사용자·타사·익명 차단 (로컬 DB)',async()=>{
 const db=new PGlite();try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key,created_at timestamptz default now());create table auth.identities(user_id uuid,provider text);create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to authenticated;`);
  for(const file of ['002-supabase-auth.sql','004-membership-providers.sql','004-membership-providers.sql'])await db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  for(const id of [memberId,adminId,googleId]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query('insert into public.app_memberships(user_id) values($1)',[id]);await db.query("insert into auth.identities values($1,'google')",[id]);}
  await db.query("update public.app_memberships set company_id='jongro',role='admin',approval_status='approved',active=true where user_id=$1",[adminId]);await db.query("update public.app_memberships set company_id='other',role='admin',approval_status='approved',active=true where user_id=$1",[googleId]);
  async function asUser(id:string){return db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id})]);await tx.exec('set local role authenticated');return tx.query('select * from public.app_membership_providers()');});}
  const rows=(await asUser(adminId)).rows as any[];assert.deepEqual(rows.map(r=>r.user_id).sort(),[memberId,adminId].sort());assert(rows.every(r=>r.providers[0]==='google'));assert.equal((await asUser(memberId)).rows.length,0);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select * from public.app_membership_providers()');}));
  // The existing membership RLS permits rejecting an unassigned request into the reviewing company.
  const rejected=await db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adminId})]);await tx.exec('set local role authenticated');return tx.query("update public.app_memberships set company_id='jongro',role=null,approval_status='rejected',active=false where user_id=$1 and approval_status='pending' returning approval_status",[memberId]);});
  assert.equal((rejected.rows[0] as any).approval_status,'rejected');assert.equal((await db.query('select id from auth.users where id=$1',[memberId])).rows.length,1);
 }finally{await db.close();}
});

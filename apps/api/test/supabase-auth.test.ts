import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {NestFactory} from '@nestjs/core';
import request from 'supertest';
import {AppModule} from '../src/app.module';
import {fixture} from './supabase-fixture';
const id='10000000-0000-4000-8000-000000000001', adminId='10000000-0000-4000-8000-000000000002';
test('Supabase 로그인은 승인대기이며 관리자 배정 전 차단하고 변경된 권한을 즉시 반영한다',async()=>{
 const f=await fixture();try{
  const pending=request.agent(f.a.getHttpServer()),admin=request.agent(f.a.getHttpServer());
  await pending.post('/api/auth/login').send({login:'member@example.test',password:'wrong'}).expect(401);
  const login=await pending.post('/api/auth/login').send({login:'member@example.test',password:'Fixture123!'}).expect(201);
  assert((login.headers['set-cookie'] as unknown as string[]).some(c=>c.includes('HttpOnly')&&c.includes('SameSite=Lax')));assert(!JSON.stringify(login.body).includes('access_token'));
  const sessionCookie=(login.headers['set-cookie'] as unknown as string[]).find(c=>/auth-token=/.test(c))!;assert(Number(/Max-Age=(\d+)/.exec(sessionCookie)?.[1])>86400,'SSR cookie seconds must be converted to Express milliseconds');
  let me=(await pending.get('/api/auth/me').expect(200)).body;assert.equal(me.access,'pending');assert.equal(me.user,null);assert.equal(me.company,null);assert.equal(f.rows.get(id).role,null);assert.equal(f.rows.get(id).company_id,null);
  await pending.get('/api/sites').expect(403);await pending.put('/api/users/'+id).send({companyId:'jongro',role:'admin'}).expect(403);
  await request(f.a.getHttpServer()).get('/api/sites').set('Authorization','Bearer forged').expect(401);
  await admin.post('/api/auth/login').send({login:'admin@example.test',password:'Fixture123!'}).expect(201);await admin.get('/api/auth/me').expect(200);
  Object.assign(f.rows.get(adminId),{company_id:'jongro',role:'admin',approval_status:'approved',active:true});
  assert((await admin.get('/api/users').expect(200)).body.some((u:any)=>u.id===id));
  const assignment={companyId:'jongro',role:'staff',active:true,locked:false,approvalStatus:'승인',siteIds:['S001'],permissions:['writeQuotes'],displayName:'직원'};
  await admin.put('/api/users/'+id).send({...assignment,companyId:'other'}).expect(403);
  await admin.put('/api/users/'+id).send(assignment).expect(200);me=(await pending.get('/api/auth/me').expect(200)).body;assert.equal(me.user.role,'staff');assert.equal(me.access,'approved');
  await pending.get('/api/operational/sites').expect(200);await pending.get('/api/users').expect(403);await pending.get('/api/sites').set('x-company-id','other').expect(403);
  await admin.put('/api/users/'+id).send({...assignment,locked:true}).expect(200);assert.equal((await pending.get('/api/auth/me')).body.access,'blocked');await pending.get('/api/operational/sites').expect(403);
  await admin.put('/api/users/'+id).send({...assignment,role:'worker',workerId:'missing'}).expect(400);
  await admin.put('/api/users/'+id).send({...assignment,role:'customer',permissions:[]}).expect(200);assert.equal((await pending.get('/api/auth/me')).body.access,'customer');await pending.get('/api/operational/sites').expect(403);
  await pending.post('/api/auth/logout').set('Origin','https://foreign.example').expect(403);await pending.post('/api/auth/logout').expect(201);await pending.get('/api/auth/me').expect(401);
 }finally{await f.close();}
});
test('Supabase PKCE·HttpOnly 세션 갱신·서버 재시작·제공자 연결은 동일 UUID를 유지한다 (모의 공급자)',async()=>{
 const f=await fixture();try{
  const agent=request.agent(f.a.getHttpServer());const start=await agent.get('/api/auth/google').expect(303);const url=new URL(start.headers.location);
  assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('redirect_to'),'http://localhost:3000/api/auth/callback');assert.equal(url.searchParams.get('code_challenge_method'),'s256');f.setChallenge(url.searchParams.get('code_challenge')!);
  await request(f.a.getHttpServer()).get('/api/auth/callback?code=valid-code').expect(303).expect('Location','http://localhost:3000/?auth_error=callback');
  const callback=await agent.get('/api/auth/callback?code=valid-code').expect(303).expect('Location','http://localhost:3000/');const me=(await agent.get('/api/auth/me').expect(200)).body;assert.equal(me.access,'pending');
  const cookie=(callback.headers['set-cookie'] as unknown as string[]).map(c=>c.split(';')[0]).find(c=>/auth-token=/.test(c))!;assert(cookie);
  const [name,encoded]=cookie.split('=');const session=JSON.parse(Buffer.from(decodeURIComponent(encoded).slice(7),'base64url').toString());session.expires_at=Math.floor(Date.now()/1000)-20;
  const refreshed=await request(f.a.getHttpServer()).get('/api/auth/me').set('Cookie',name+'=base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).expect(200);assert(f.refreshes>0);assert(refreshed.headers['set-cookie']);
  const restarted=await f.app();try{await request(restarted.getHttpServer()).get('/api/auth/me').set('Cookie',cookie).expect(200);}finally{await restarted.close();}
  f.people.get('member')!.identities.push({id:'google',user_id:id,provider:'google'});const linked=(await agent.get('/api/auth/me')).body;assert.equal(linked.account.id,me.account.id);assert.deepEqual(linked.account.providers,['email','google']);assert.equal(linked.access,'pending');
  await agent.post('/api/auth/link/google').expect(303);
 }finally{await f.close();}
});
test('실제 승인 SQL/RLS는 자기 승인, 타사 조회·배정, 마지막 관리자 제거를 거부한다',async()=>{
 const db=new PGlite();try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
  create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
  grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
  await db.exec(readFileSync(new URL('../migrations/002-supabase-auth.sql',import.meta.url),'utf8'));
  const other='10000000-0000-4000-8000-000000000003';
  for(const who of [id,adminId,other]){await db.query('insert into auth.users(id) values($1)',[who]);await db.query('insert into public.app_memberships(user_id,email) values($1,$2)',[who,who+'@test.invalid']);}
  async function asUser(who:string,sql:string,args:any[]=[]){return db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:who,email:who+'@test.invalid'})]);await tx.exec('set local role authenticated');return tx.query(sql,args);});}
  assert.equal((await asUser(id,"update public.app_memberships set company_id='jongro',role='admin',active=true,approval_status='approved' where user_id=$1 returning *",[id])).rows.length,0);
  await db.query("update public.app_memberships set company_id='jongro',role='admin',active=true,approval_status='approved' where user_id=$1",[adminId]);await db.query("update public.app_memberships set company_id='other',role='admin',active=true,approval_status='approved' where user_id=$1",[other]);
  assert.equal((await asUser(adminId,'select * from public.app_memberships where user_id=$1',[other])).rows.length,0);
  await assert.rejects(asUser(adminId,"update public.app_memberships set company_id='other' where user_id=$1",[id]));
  await assert.rejects(asUser(adminId,"update public.app_memberships set role='staff' where user_id=$1",[adminId]));await assert.rejects(asUser(adminId,'delete from public.app_memberships where user_id=$1',[adminId]));
 }finally{await db.close();}
});

test('운영 환경은 데모와 암묵적인 메모리 로그인으로 우회하지 않는다',async()=>{
 const prior={node:process.env.NODE_ENV,app:process.env.APP_ENV,demo:process.env.DEMO_LOGIN_ENABLED};
 process.env.NODE_ENV='production';delete process.env.APP_ENV;process.env.DEMO_LOGIN_ENABLED='true';
 const a=await NestFactory.create(AppModule,{logger:false});a.setGlobalPrefix('api');await a.init();
 try{
  const config=(await request(a.getHttpServer()).get('/api/auth/config').expect(200)).body;
  assert.equal(config.demoEnabled,false);assert.equal(config.authMode,'supabase');assert.equal(config.supabaseConfigured,false);
  await request(a.getHttpServer()).get('/api/auth/me').expect(401);
  await request(a.getHttpServer()).post('/api/auth/demo').send({account:'admin'}).expect(401);
  await request(a.getHttpServer()).post('/api/auth/login').send({login:'admin@jongro.test',password:'Jongro2026!'}).expect(503);
 }finally{await a.close();for(const[k,v]of Object.entries({NODE_ENV:prior.node,APP_ENV:prior.app,DEMO_LOGIN_ENABLED:prior.demo})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

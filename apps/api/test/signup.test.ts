import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import request from 'supertest';
import {fixture} from './supabase-fixture';
import {SupabaseAuthService} from '../src/supabase-auth';
import {authDiagnostic,googleLinkFailure,signupFailure,signupSuccessMessage} from '../src/auth-errors';
test('가입 오류: 중복·비밀번호 요구조건·이메일·발송 제한·서버 구분과 민감정보 제거',()=>{
 for(const code of ['user_already_exists','email_exists'])assert.equal(signupFailure({code}).code,'SIGNUP_EMAIL_EXISTS');
 const weak=signupFailure({code:'weak_password',message:'Password should be at least 12 characters and contain ABCDEFGHIJKLMNOPQRSTUVWXYZ, abcdefghijklmnopqrstuvwxyz, 0123456789, !@#'});for(const word of ['12자','대문자','소문자','숫자','특수문자'])assert(weak.message.includes(word));
 assert.match(signupFailure({code:'weak_password',reasons:['pwned']}).message,/유출/);
 assert.match(googleLinkFailure({code:'identity_already_exists'}),/이미 연결/);assert.match(googleLinkFailure({status:429}),/잠시 후/);
 assert.equal(signupFailure({code:'email_address_invalid'}).code,'SIGNUP_INVALID_EMAIL');
 assert.equal(signupFailure({code:'over_email_send_rate_limit',status:429}).status,429);
 for(const code of ['email_provider_disabled','signup_disabled','unexpected_failure','email_address_not_authorized'])assert.equal(signupFailure({code,status:500}).message,'회원가입 서버 연결을 확인해 주세요.');
 const logged=authDiagnostic('email_signup_failed',{code:'weak_password',status:422,message:'input SensitivePassword123! eyJabc.def.ghi sb_secret_hidden refresh_token=refresh-value'},['SensitivePassword123!']);for(const secret of ['SensitivePassword123!','eyJabc.def.ghi','sb_secret_hidden','refresh-value'])assert(!logged.includes(secret));assert.match(logged,/weak_password/);assert.match(logged,/422/);
});
test('SDK 가입: 상세 메타데이터·실제 오류·중복 마스킹 응답과 성공 문구',async()=>{
 const f=await fixture();try{
  const service=f.a.get(SupabaseAuthService),logs:string[]=[];let sent:any;let result:any;
  (service as any).logger.error=(line:string)=>logs.push(line);(service as any).logger.warn=(line:string)=>logs.push(line);
  service.client=(()=>({auth:{signUp:async(input:any)=>{sent=input;return result;}}})) as any;
  const body={email:'new@example.test',name:'가입자',phone:'010-1234-5678',companyName:'신청 회사',role:'worker',password:'SensitivePassword123!'};
  const http=f.a.getHttpServer();
  for(const [error,status,code]of [[{code:'user_already_exists',status:422,message:'User already registered'},409,'SIGNUP_EMAIL_EXISTS'],[{code:'weak_password',status:422,message:'Password should be at least 12 characters'},400,'SIGNUP_PASSWORD_POLICY'],[{code:'over_email_send_rate_limit',status:429,message:'Email rate limit exceeded'},429,'SIGNUP_EMAIL_RATE_LIMIT'],[{code:'email_provider_disabled',status:400,message:'Email provider disabled'},503,'SIGNUP_SERVER_ERROR']] as const){result={data:{user:null},error};const r=await request(http).post('/api/auth/signup').send(body).expect(status);assert.equal(r.body.code,code);}
  result={data:{user:{id:'masked',identities:[]}},error:null};await request(http).post('/api/auth/signup').send(body).expect(409);
  result={data:{user:{id:'new',identities:[{provider:'email'}]}},error:null};const success=await request(http).post('/api/auth/signup').send(body).expect(201);assert.equal(success.body.message,signupSuccessMessage);
  assert.deepEqual(sent.options.data,{display_name:'가입자',phone:'010-1234-5678',requested_role:'worker',requested_company:'신청 회사'});assert.equal(sent.options.data.role,undefined);
  await request(http).post('/api/auth/signup').send({...body,role:'admin'}).expect(400);await request(http).post('/api/auth/signup').send({...body,email:'bad-email'}).expect(400);
  assert(logs.some(l=>l.includes('user_already_exists')));assert(!logs.join('').includes(body.password));
 }finally{await f.close();}
});
test('005 SQL: 가입 즉시 pending 생성·phone/희망역할 보존·기존 관리자 보존·재적용·자기 승인 차단',async()=>{
 const db=new PGlite();try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant usage on schema auth to authenticated;`);
  await db.exec(readFileSync(new URL('../migrations/002-supabase-auth.sql',import.meta.url),'utf8'));
  const admin='10000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000004';
  await db.query("insert into auth.users(id,email) values($1,'admin@example.test')",[admin]);await db.query("insert into public.app_memberships(user_id,email,display_name,company_id,role,approval_status,active) values($1,'admin@example.test','기존 관리자','jongro','admin','approved',true)",[admin]);
  const migration=readFileSync(new URL('../migrations/005-signup-profile.sql',import.meta.url),'utf8');await db.exec(migration);
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,'new@example.test',{display_name:'신규 가입',phone:'010-1234-5678',requested_company:'신청 회사',requested_role:'worker',role:'admin',companyId:'jongro'}]);
  const row=(await db.query('select * from public.app_memberships where user_id=$1',[id])).rows[0] as any;assert.equal(row.phone,'010-1234-5678');assert.equal(row.requested_role,'worker');assert.equal(row.role,null);assert.equal(row.company_id,null);assert.equal(row.active,false);assert.equal(row.approval_status,'pending');assert(row.registered_at);
  await db.exec(migration);const existing=(await db.query('select * from public.app_memberships where user_id=$1',[admin])).rows[0] as any;assert.equal(existing.role,'admin');assert.equal(existing.active,true);assert.equal(existing.display_name,'기존 관리자');
  const self=await db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,email:'new@example.test'})]);await tx.exec('set local role authenticated');return tx.query("update public.app_memberships set role='admin',company_id='jongro',approval_status='approved',active=true where user_id=$1 returning *",[id]);});assert.equal(self.rows.length,0);
  // User metadata updates cannot change an existing approval or the signup snapshot.
  await db.query("update auth.users set raw_user_meta_data=$2 where id=$1",[admin,{role:'customer',requested_role:'customer'}]);assert.equal(((await db.query('select role from public.app_memberships where user_id=$1',[admin])).rows[0] as any).role,'admin');
 }finally{await db.close();}
});

test('이메일 전체 흐름: 신규 SDK 가입 → 인증 전 차단 → 인증 → pending → 관리자 승인 → 재로그인 없이 업무 진입',async()=>{
 const f=await fixture();try{
  const http=f.a.getHttpServer(),applicant=request.agent(http),admin=request.agent(http);
  const body={email:'new-flow@example.test',name:'신규 실습자',phone:'010-5555-1234',companyName:'희망 회사',role:'worker',password:'Fixture123!'};
  await applicant.post('/api/auth/signup').send(body).expect(201);
  const person=[...f.people.values()].find(p=>p.email===body.email)!;assert(person);const membership=f.rows.get(person.id);assert.equal(membership.phone,body.phone);assert.equal(membership.requested_role,'worker');assert.equal(membership.role,null);
  await applicant.post('/api/auth/login').send({login:body.email,password:body.password}).expect(401);
  f.confirmEmail(body.email);
  await applicant.post('/api/auth/login').send({login:body.email,password:body.password}).expect(201);assert.equal((await applicant.get('/api/auth/me').expect(200)).body.access,'pending');await applicant.get('/api/sites').expect(403);
  await admin.post('/api/auth/login').send({login:'admin@example.test',password:'Fixture123!'});await admin.get('/api/auth/me');Object.assign(f.rows.get('10000000-0000-4000-8000-000000000002'),{company_id:'jongro',role:'admin',approval_status:'approved',active:true});
  const card=(await admin.get('/api/users').expect(200)).body.find((u:any)=>u.id===person.id);assert.equal(card.phone,body.phone);assert.equal(card.requestedRole,'worker');
  await admin.post('/api/users/'+person.id+'/approval').send({action:'approve',companyId:'jongro',role:'staff',siteIds:['S001'],permissions:['writeQuotes']}).expect(201);
  const approved=(await applicant.get('/api/auth/me').expect(200)).body;assert.equal(approved.access,'approved');assert.equal(approved.user.role,'staff');assert.equal(approved.user.requestedRole,'worker');await applicant.get('/api/operational/sites').expect(200);
  const before=f.people.size;const again=await applicant.post('/api/auth/signup').send(body).expect(409);assert.equal(again.body.code,'SIGNUP_EMAIL_EXISTS');assert.equal(f.people.size,before);
 }finally{await f.close();}
});

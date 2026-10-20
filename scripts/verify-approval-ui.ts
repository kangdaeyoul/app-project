// Local browser integration with fake Supabase identities; no production user changes.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fixture} from '../apps/api/test/supabase-fixture';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const memberId='10000000-0000-4000-8000-000000000001',adminId='10000000-0000-4000-8000-000000000002',googleId='10000000-0000-4000-8000-000000000003';
(async()=>{
 process.env.DEMO_LOGIN_ENABLED='false';
 const f=await fixture();Object.assign(f.people.get('member').user_metadata,{phone:'010-5555-1234',requested_role:'worker'});await f.a.listen(4000,'127.0.0.1');
 f.people.set('googleApplicant',{id:googleId,email:'google@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-10-19T00:00:00Z',user_metadata:{display_name:'Google 신청자',requested_company:'예시 신청 회사'},identities:[{id:'google',user_id:googleId,provider:'google'}]});
 const web=spawn(process.execPath,[process.cwd()+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3000'],{cwd:process.cwd()+'/apps/admin-web',stdio:'ignore'});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const errors:string[]=[];
 try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:3000')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  for(const [name,role,viewport]of [['pc','staff',{width:1440,height:1000}],['iphone','admin',{width:390,height:844}],['android','worker',{width:412,height:915}]] as const){
   f.rows.delete(memberId);f.rows.delete(googleId);f.setLinkError(null);
   const member=await browser.newContext({viewport}),admin=await browser.newContext({viewport,isMobile:name!=='pc',hasTouch:name!=='pc'});
   await member.request.post('http://127.0.0.1:3000/api/auth/login',{data:{login:'member@example.test',password:'Fixture123!'}});
   await member.request.get('http://127.0.0.1:3000/api/auth/me');
   const applicant=await browser.newContext();await applicant.request.post('http://127.0.0.1:3000/api/auth/login',{data:{login:'google@example.test',password:'Fixture123!'}});await applicant.request.get('http://127.0.0.1:3000/api/auth/me');
   await admin.request.post('http://127.0.0.1:3000/api/auth/login',{data:{login:'admin@example.test',password:'Fixture123!'}});await admin.request.get('http://127.0.0.1:3000/api/auth/me');
   Object.assign(f.rows.get(adminId),{company_id:'jongro',role:'admin',approval_status:'approved',active:true});
   const mp=await member.newPage(),ap=await admin.newPage();for(const p of [mp,ap])p.on('pageerror',(e:any)=>errors.push(e.message));
   await mp.goto('http://127.0.0.1:3000');await mp.getByRole('heading',{name:'가입 승인대기',exact:true}).waitFor();
   await ap.goto('http://127.0.0.1:3000');await ap.getByRole('button',{name:/가입 승인대기 2명/}).click();
   await ap.getByRole('heading',{name:/가입 승인 요청 2건/}).waitFor();
   const gc=ap.getByRole('article',{name:'google@example.test 가입 요청',exact:true});await gc.getByText('Google',{exact:true}).waitFor();await gc.getByText('예시 신청 회사',{exact:true}).waitFor();
   const card=ap.getByRole('article',{name:'member@example.test 가입 요청',exact:true});
   await card.getByText('010-5555-1234',{exact:true}).waitFor();await card.getByText(/작업진행자 · 승인 참고용/).waitFor();
   await card.getByRole('button',{name:'상세보기',exact:true}).click();await ap.getByRole('dialog',{name:'가입 요청 상세',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();
   await card.getByRole('button',{name:'승인하기',exact:true}).click();
   const dialog=ap.getByRole('dialog',{name:'가입 승인 설정',exact:true});await dialog.waitFor();assert.equal(f.rows.get(memberId).approval_status,'pending');
   await dialog.getByLabel('소속 회사',{exact:true}).selectOption('jongro');await dialog.getByLabel('역할',{exact:true}).selectOption(role);
   if(role==='staff'){await dialog.getByLabel('종로 오피스 소방시설 개선',{exact:true}).check();await dialog.getByLabel('견적 작성',{exact:true}).check();}
   if(role==='worker')await dialog.getByLabel('작업진행자 연결',{exact:true}).selectOption('W001');
   await ap.screenshot({path:`/tmp/approval-${name}-dialog.png`});
   await dialog.getByRole('button',{name:'승인 완료',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(f.rows.get(memberId).role,role);assert.equal(f.rows.get(memberId).active,true);
   const refresh=mp.getByRole('button',{name:'승인 상태 다시 확인',exact:true});if(await refresh.isVisible())await refresh.click();
   await mp.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
   const status=await(await member.request.get('http://127.0.0.1:3000/api/auth/me')).json();assert.equal(status.access,'approved');assert.equal(status.user.role,role);
   ap.on('dialog',(d:any)=>d.accept());await gc.getByRole('button',{name:'거절',exact:true}).click();await ap.getByText('승인대기 중인 가입 요청이 없습니다.',{exact:true}).waitFor();assert(f.people.has('googleApplicant'));assert.equal(f.rows.get(googleId).approval_status,'rejected');
   await ap.getByRole('row').filter({hasText:'member@example.test'}).getByRole('button',{name:'수정',exact:true}).click();await ap.getByRole('heading',{name:'사용자 수정',exact:true}).waitFor();
   f.setLinkError({code:'manual_linking_disabled',msg:'Manual linking is disabled'});
   await mp.getByRole('button',{name:'Google 계정 연결',exact:true}).click();await mp.getByRole('alert').filter({hasText:'수동 계정 연결'}).waitFor();assert.equal(mp.url(),'http://127.0.0.1:3000/');
   console.log(`${name}/${role}: home count → pending cards → details/approval dialog → immediate access; reject keeps Auth; edit preserved; Google link error inline passed`);
   await member.close();await admin.close();await applicant.close();
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();web.kill('SIGTERM');await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

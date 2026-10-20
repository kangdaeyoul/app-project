// Local mock-provider confirmation. No production email is sent or Google consent performed.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fixture} from '../apps/api/test/supabase-fixture';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 process.env.DEMO_LOGIN_ENABLED='false';const f=await fixture();await f.a.listen(4000,'127.0.0.1');
 const web=spawn(process.execPath,[process.cwd()+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3000'],{cwd:process.cwd()+'/apps/admin-web',stdio:'ignore'});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:3000')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const context=await browser.newContext(),page=await context.newPage();await page.goto('http://127.0.0.1:3000');await page.getByRole('button',{name:'가입 신청',exact:true}).click();
  const form=page.locator('form').filter({has:page.getByRole('heading',{name:'가입 신청',exact:true})});
  for(const [label,value] of [['이름','새 가입자'],['이메일','browser-signup@example.test'],['휴대전화','010-2222-3333'],['회사명','희망 회사'],['비밀번호','Fixture123!']])await form.getByLabel(label,{exact:true}).fill(value);
  await form.locator('select').selectOption('worker');await form.getByRole('button',{name:'가입 신청 제출',exact:true}).click();
  await form.getByRole('status').filter({hasText:'가입 신청이 완료되었습니다. 이메일 인증 후 로그인해 주세요.'}).waitFor();
  assert.equal(await form.getByLabel('비밀번호',{exact:true}).inputValue(),'');
  const user=[...f.people.values()].find(p=>p.email==='browser-signup@example.test')!;assert.equal(f.rows.get(user.id).requested_role,'worker');assert.equal(f.rows.get(user.id).role,null);
  f.confirmEmail(user.email);
  await form.getByRole('button',{name:'로그인으로 돌아가기',exact:true}).click();await page.getByLabel('이메일 또는 아이디',{exact:true}).fill(user.email);await page.getByLabel('비밀번호',{exact:true}).fill('Fixture123!');await page.getByRole('button',{name:'이메일 로그인',exact:true}).click();await page.getByRole('heading',{name:'가입 승인대기',exact:true}).waitFor();
  const admin=await browser.newContext();await admin.request.post('http://127.0.0.1:3000/api/auth/login',{data:{login:'admin@example.test',password:'Fixture123!'}});await admin.request.get('http://127.0.0.1:3000/api/auth/me');Object.assign(f.rows.get('10000000-0000-4000-8000-000000000002'),{company_id:'jongro',role:'admin',approval_status:'approved',active:true});
  const ap=await admin.newPage();await ap.goto('http://127.0.0.1:3000');await ap.getByRole('button',{name:/가입 승인대기 1명/}).click();const card=ap.getByRole('article',{name:user.email+' 가입 요청',exact:true});await card.getByText('010-2222-3333',{exact:true}).waitFor();await card.getByRole('button',{name:'승인하기',exact:true}).click();const dialog=ap.getByRole('dialog',{name:'가입 승인 설정',exact:true});await dialog.getByLabel('소속 회사',{exact:true}).selectOption('jongro');await dialog.getByLabel('역할',{exact:true}).selectOption('staff');await dialog.getByRole('button',{name:'승인 완료',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const refresh=page.getByRole('button',{name:'승인 상태 다시 확인',exact:true});if(await refresh.isVisible())await refresh.click();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByRole('button',{name:'가입 신청',exact:true}).click();
  for(const [label,value]of [['이름','새 가입자'],['이메일',user.email],['휴대전화','010-2222-3333'],['회사명','희망 회사'],['비밀번호','Fixture123!']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'가입 신청 제출',exact:true}).click();await page.getByRole('alert').filter({hasText:'이미 가입된 이메일입니다.'}).waitFor();
  console.log('Signup UI: success text, phone/requested role, mock email confirmation, pending → admin approval → refresh access, duplicate guidance passed');await context.close();await admin.close();
 }finally{await browser.close();web.kill('SIGTERM');await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

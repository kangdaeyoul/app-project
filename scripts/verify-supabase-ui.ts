// Local fake-identity browser integration. This does not sign in to Google.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fixture} from '../apps/api/test/supabase-fixture';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const f=await fixture();process.env.AUTH_GOOGLE_ENABLED='true';await f.a.listen(4000,'127.0.0.1');
 const web=spawn(process.execPath,[process.cwd()+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3000'],{cwd:process.cwd()+'/apps/admin-web',stdio:'ignore'});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const errors:string[]=[];
 try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:3000')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const contexts:any[]=[];
  for(const [name,viewport]of [['pc',{width:1440,height:1000}],['iphone',{width:390,height:844}],['android',{width:412,height:915}]] as const){
   const context=await browser.newContext({viewport,isMobile:name!=='pc',hasTouch:name!=='pc'});contexts.push(context);
   const page=await context.newPage();page.on('pageerror',(e:any)=>errors.push(e.message));await page.goto('http://127.0.0.1:3000');
   await page.getByRole('button',{name:'로그인',exact:true}).click();
   await page.getByRole('link',{name:'Google로 로그인',exact:true}).waitFor();
   await page.getByLabel('이메일 또는 아이디',{exact:true}).fill('member@example.test');await page.getByLabel('비밀번호',{exact:true}).fill('Fixture123!');
   await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('heading',{name:'관리자 승인 대기 중입니다.',exact:true}).waitFor();
   assert.equal(await page.locator('main[data-onboarding-screen]').count(),0);
   assert(!(await page.evaluate(()=>document.cookie)).includes('auth-token'));
   const cookies=await context.cookies();assert(cookies.some((c:any)=>c.name.includes('auth-token')&&c.httpOnly&&c.expires>0));
   await page.reload();await page.getByRole('heading',{name:'관리자 승인 대기 중입니다.',exact:true}).waitFor();
   await page.screenshot({path:`/tmp/supabase-${name}-pending.png`});
   await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('button',{name:'로그인',exact:true}).waitFor();
   assert(!(await context.cookies()).some((c:any)=>/auth-token(?:\.\d+)?$/.test(c.name)));
   console.log(name+': real-login UI, pending gate, reload session, HttpOnly cookie, signout passed (mock Supabase)');
  }
  const admin=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(admin);
  await admin.request.post('http://127.0.0.1:3000/api/auth/login',{data:{login:'admin@example.test',password:'Fixture123!'}});
  await admin.request.get('http://127.0.0.1:3000/api/auth/me');
  Object.assign(f.rows.get('10000000-0000-4000-8000-000000000002'),{company_id:'jongro',role:'admin',approval_status:'approved',active:true});
  const ap=await admin.newPage();await ap.goto('http://127.0.0.1:3000');
  await ap.locator('aside nav button').filter({hasText:'사용자 관리'}).click();
  await ap.getByRole('button',{name:'승인대기',exact:true}).click();
  await ap.getByRole('article',{name:'member@example.test 가입 요청'}).getByRole('button',{name:'승인하기',exact:true}).click();
  await ap.screenshot({path:'/tmp/supabase-admin-approval.png'});
  await ap.getByLabel('소속 회사',{exact:true}).selectOption('jongro');
  await ap.getByLabel('역할',{exact:true}).selectOption('staff');
  await ap.getByRole('button',{name:'승인 완료',exact:true}).click();
  await ap.getByText('가입 승인을 완료했습니다.',{exact:false}).waitFor();
  const member=contexts[0];await member.request.post('http://127.0.0.1:3000/api/auth/login',{data:{login:'member@example.test',password:'Fixture123!'}});
  const status=await (await member.request.get('http://127.0.0.1:3000/api/auth/me')).json();assert.equal(status.access,'approved');assert.equal(status.user.companyId,'jongro');assert.equal(status.user.role,'staff');
  console.log('Administrator UI: pending applicant company/role assignment and approval passed (mock Supabase)');
  assert.deepEqual(errors,[]);for(const c of contexts)await c.close();
 }finally{await browser.close();web.kill('SIGTERM');await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

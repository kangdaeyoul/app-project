// Isolated local browser verification; no real Supabase or Google account used.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fixture} from '../apps/api/test/supabase-fixture';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 process.env.DEMO_LOGIN_ENABLED='false';
 const f=await fixture();await f.a.listen(4000,'127.0.0.1');
 const web=spawn(process.execPath,[process.cwd()+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3000'],{cwd:process.cwd()+'/apps/admin-web',stdio:'ignore'});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const errors:string[]=[];
 try{
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:3000')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  for(const [name,role,viewport]of [['pc','admin',{width:1440,height:1000}],['iphone','staff',{width:390,height:844}],['android','worker1',{width:412,height:915}]] as const){
   const context=await browser.newContext({viewport,isMobile:name!=='pc',hasTouch:name!=='pc'});
   const page=await context.newPage();page.on('pageerror',(e:any)=>errors.push(e.message));
   await page.goto('http://127.0.0.1:3000');
   await page.getByRole('button',{name:'이메일 로그인',exact:true}).waitFor();
   await page.evaluate(()=>navigator.serviceWorker.ready);
   assert.equal((await context.request.get('http://127.0.0.1:3000/manifest.webmanifest')).status(),200);
   await page.getByRole('link',{name:'Google로 계속하기',exact:true}).waitFor();
   for(const label of ['Kakao','Naver','Apple'])assert(await page.getByRole('button',{name:label+' (준비 중)',exact:true}).isDisabled());
   await page.getByRole('button',{name:'로그인 없이 체험하기',exact:true}).click();
   await page.getByRole('heading',{name:'체험판 사용 안내',exact:true}).waitFor();
   await page.getByLabel('체험 역할',{exact:true}).selectOption(role);
   await page.getByRole('button',{name:'그냥 체험하기',exact:true}).click();
   await page.getByRole('button',{name:'예시 데이터 초기화',exact:true}).waitFor();
   const me=await (await context.request.get('http://127.0.0.1:3000/api/auth/me')).json();
   assert.equal(me.authMode,'trial');assert.equal(me.user.role,role==='worker1'?'worker':role);
   assert(!(await page.evaluate(()=>document.cookie)).includes('field_trial'));
   assert((await context.cookies()).some((c:any)=>c.name==='field_trial'&&c.httpOnly));
   await page.reload();await page.getByRole('button',{name:'예시 데이터 초기화',exact:true}).waitFor();
   page.on('dialog',(d:any)=>d.accept());
   await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'예시 데이터 초기화',exact:true}).click()]);
   await page.getByRole('button',{name:'예시 데이터 초기화',exact:true}).waitFor();
   const empty=await (await context.request.get('http://127.0.0.1:3000/api/operational/sites')).json();assert.equal(empty.length,0);
   await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'예시 데이터 다시 생성',exact:true}).click()]);
   await page.getByRole('button',{name:'튜토리얼 다시보기',exact:true}).waitFor();
   const seeded=await (await context.request.get('http://127.0.0.1:3000/api/operational/sites')).json();assert(seeded.length>0);
   await page.screenshot({path:`/tmp/trial-${name}-${role}.png`,fullPage:true});
   await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'튜토리얼 다시보기',exact:true}).click()]);
   await page.getByRole('button',{name:'예시 데이터 초기화',exact:true}).waitFor();
   await page.waitForFunction(async()=>{const r=await fetch('/api/tutorial/progress');return (await r.json()).status==='in_progress';});
   const progress=await (await context.request.get('http://127.0.0.1:3000/api/tutorial/progress')).json();assert.equal(progress.status,'in_progress');
   const cachePaths=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async k=>(await (await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)))).flat();});assert(!cachePaths.some((p:string)=>p.startsWith('/api/')));
   await page.getByRole('button',{name:'로그아웃',exact:true}).click();
   await page.getByRole('button',{name:'로그인 없이 체험하기',exact:true}).waitFor();
   console.log(`${name}/${role}: login providers, role entry, HttpOnly cookie, reload, reset/regenerate, tutorial replay, logout passed`);
   await context.close();
  }
  const context=await browser.newContext();const page=await context.newPage();page.on('pageerror',(e:any)=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3000');await page.getByRole('button',{name:'로그인 없이 체험하기',exact:true}).click();
  await page.getByRole('button',{name:'튜토리얼과 함께 체험하기',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await fetch('/api/tutorial/progress');return r.ok&&(await r.json()).status==='in_progress';});
  console.log('Guided entry: tutorial starts from first step');await context.close();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();web.kill('SIGTERM');await f.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

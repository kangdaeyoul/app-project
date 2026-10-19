// Run against a local disposable sample instance; never use this on a live service.
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/verify-generic-ux.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { tutorialSteps, TUTORIAL_VERSION } = require('../packages/shared/dist');
const baseURL = process.env.UX_TEST_BASE_URL || 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw Error('Use a disposable localhost instance only');
const output = process.env.UX_TEST_OUTPUT || '/tmp/generic-ux';
fs.mkdirSync(output, {recursive:true});
const report = [];
const errors = [];
async function json(context, path, method='GET', data) {
  const r = await context.request.fetch(baseURL+'/api'+path,{method,data});
  assert(r.ok(), path+' '+r.status()); return r.json();
}
async function launchContext(browser, viewport, mobile=false, standalone=false) {
  const c = await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,baseURL});
  if (standalone) await c.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)' ? Object.defineProperty(original(query), 'matches', {value:true}) : original(query);
    Object.defineProperty(navigator,'standalone',{value:true});
  });
  return c;
}
async function login(context, account, tour=false) {
  await json(context,'/auth/demo','POST',{account});
  await json(context,'/tutorial/progress','PUT',{status:tour?'in_progress':'skipped',step:0,version:TUTORIAL_VERSION});
  if (tour) await json(context,'/tutorial/samples','POST');
  if (account==='admin') await json(context,'/initial-setup','PUT',{introSeen:true});
}
async function pageFor(context) {
  const p=await context.newPage(); p.setDefaultTimeout(10000); p.on('pageerror',e=>errors.push(e.message));
  p.on('dialog',d=>d.accept()); await p.goto(baseURL); await p.locator('main[data-onboarding-screen]').waitFor(); return p;
}
async function checkActions(page) {
  const bar=page.getByLabel('견적 저장 액션바'); await bar.waitFor();
  for (const scroll of [0,99999]) {
    await page.evaluate(y=>window.scrollTo(0,y),scroll);
    for (const name of ['회사정보 / 프로필 변경','거래처','미리보기','저장']) {
      const b=bar.getByRole('button',{name,exact:true}); const box=await b.boundingBox();
      assert(box && box.x>=0 && box.y>=0 && box.x+box.width<=page.viewportSize().width+1 && box.y+box.height<=page.viewportSize().height+1,`Visible action: ${name}`);
      assert(await b.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}), `Unobstructed action: ${name}`);
    }
  }
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  if (process.env.UX_TEST_SECTION !== "quotes") {
  // Login brand, blank signup, and trial notice are visible without writing signup data.
  const entry=await launchContext(browser,{width:1440,height:1000}); const ep=await entry.newPage(); await ep.goto(baseURL);
  await ep.getByRole('button',{name:'가입 신청',exact:true}).click();
  const signup=ep.locator('form').filter({has:ep.getByRole('heading',{name:'가입 신청',exact:true})});
  assert.equal(await signup.getByLabel('회사명',{exact:true}).inputValue(),'');
  await ep.reload(); await ep.getByRole('button',{name:'관리자로 체험',exact:true}).click();
  await ep.getByRole('dialog',{name:'체험판 사용 안내'}).waitFor();
  assert((await ep.getByRole('dialog').innerText()).includes('예시'));
  await ep.getByRole('button',{name:'체험 시작',exact:true}).click();
  await ep.locator('main[data-onboarding-screen]').waitFor();
  await ep.locator('.initial-setup progress').waitFor();
  assert.equal(await ep.locator('.initial-setup progress').getAttribute('max'),'9');
  report.push('Login generic branding, blank signup, trial notice, 9-step setup'); await entry.close();
  for (const [role,account,viewport] of [
    ['admin','admin',{width:1440,height:1000}],['staff','staff',{width:412,height:915}],['worker','worker1',{width:390,height:844}]
  ]) {
    const context=await launchContext(browser,viewport,viewport.width<760); await login(context,account,true);
    const before=await json(context,'/operational/sites'); const page=await pageFor(context);
    const coach=page.getByRole('region',{name:'역할별 튜토리얼'}); await coach.waitFor();
    for (const step of tutorialSteps(role)) {
      console.log('practice',role,step.id);
      await coach.getByRole('heading',{name:step.title,exact:true}).waitFor();
      const next=coach.getByRole('button',{name:/^(다음|마침)$/}); assert(await next.isDisabled(),`${role}: ${step.id} must be saved first`);
      const examples=coach.getByRole('region',{name:'튜토리얼 예시 체험'});
      await examples.getByLabel('예시 '+step.exercise.field,{exact:true}).fill(String(step.exercise.value));
      await examples.getByRole('button',{name:'예시에만 저장',exact:true}).click();
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.tutorial-actions button')).find(el=>/^(다음|마침)$/.test(el.textContent))?.disabled);
      assert((await examples.innerText()).includes('실습 완료'));
      if(step.id==='schedule') assert((await examples.getByLabel('일정 역할별 연결').innerText()).includes('작업진행자'));
      if(step.id==='photo') await page.screenshot({path:`${output}/${role}-photo-practice.png`});
      await next.click();
    }
    await coach.getByRole('button',{name:'예시 데이터 삭제하고 시작',exact:true}).click();
    await coach.waitFor({state:'hidden'});
    assert.equal((await json(context,'/tutorial/samples')).bundle,null);
    assert.deepEqual(await json(context,'/operational/sites'),before);
    const help=page.getByRole('button',{name:'도움말',exact:true}).first(); await help.click();
    const hd=page.getByRole('dialog',{name:'화면 도움말'});
    await hd.getByRole('button',{name:'예시 데이터 생성',exact:true}).click();
    await page.waitForFunction(async()=>!!(await (await fetch('/api/tutorial/samples')).json()).bundle);
    assert((await json(context,'/tutorial/samples')).bundle.records.length>0);
    await hd.getByRole('button',{name:'예시 데이터 삭제',exact:true}).click();
    await page.waitForFunction(async()=>!(await (await fetch('/api/tutorial/samples')).json()).bundle);
    assert.deepEqual(await json(context,'/operational/sites'),before);
    report.push(`${role}: ${tutorialSteps(role).length} guided practices, completion delete, help recreate/delete, data preserved`);
    await context.close();
  }
  }
  for(const [device,viewport] of [['pc',{width:1440,height:1000}],['iphone',{width:390,height:844}],['android',{width:412,height:915}]]) {
    const context=await launchContext(browser,viewport,device!=='pc'); await login(context,'admin'); const page=await pageFor(context);
    if(device!=='pc') {await page.locator('.home-month-grid').waitFor(); assert.equal(await page.locator('.home-month-grid').count(),1);}
    assert(!(await page.locator(device==='pc'?'.brand':'.mobile-header').innerText()).includes('종로소방'));
    console.log('quote',device);
    if(device==='pc') await page.locator('aside nav button').filter({hasText:'견적'}).click();
    else await page.getByRole('button',{name:'빠른 견적 작성',exact:true}).click();
    await page.getByRole('button',{name:'＋ 새 견적 작성',exact:true}).click();
    await page.getByLabel('추가 수량',{exact:true}).waitFor(); assert.equal(await page.getByLabel('추가 수량',{exact:true}).inputValue(),'');
    assert.equal(await page.getByLabel('추가 판매단가',{exact:true}).inputValue(),'');
    console.log('check actions',device); await checkActions(page);
    const bar=page.getByLabel('견적 저장 액션바'); await bar.getByRole('button',{name:'회사정보 / 프로필 변경',exact:true}).click();
    console.log('open profile',device);
    const modal=page.getByRole('dialog',{name:'회사정보 / 회사 프로필 변경'}); await modal.waitFor();
    const original=await json(context,'/company/current'); const originalQuotes=await json(context,'/quotes');
    assert.equal(await modal.getByLabel('회사정보 회사명',{exact:true}).inputValue(),original.company.quoteProfile.name);
    await modal.getByLabel('회사정보 담당자명',{exact:true}).fill('견적별 담당자 검증');
    await modal.getByRole('button',{name:'이번 견적에만 적용',exact:true}).click();
    assert.deepEqual(await json(context,'/company/current'),original);
    assert.deepEqual(await json(context,'/quotes'),originalQuotes);
    if(device==='pc') {
      const oldQuote=await json(context,'/quotes/Q001');
      await bar.getByRole('button',{name:'회사정보 / 프로필 변경',exact:true}).click();
      await modal.getByLabel('회사정보 담당자명',{exact:true}).fill('새 견적 기본담당');
      await modal.getByRole('button',{name:'회사 기본정보 저장',exact:true}).click();
      await modal.getByText('회사 기본정보를 저장했습니다.',{exact:false}).waitFor();
      assert.equal((await json(context,'/company/current')).company.quoteProfile.contactName,'새 견적 기본담당');
      assert.deepEqual((await json(context,'/quotes/Q001')).companySnapshot,oldQuote.companySnapshot);
      await modal.getByRole('button',{name:'닫기',exact:true}).click();
      await json(context,'/company/settings','PUT',original.company);
      report.push('Company default save: new defaults changed, existing quote snapshot and current draft preserved');
    }
    console.log('preview',device);
    await bar.getByRole('button',{name:'미리보기',exact:true}).click();
    const preview=page.getByRole('dialog',{name:'견적 요약 미리보기'}); await preview.waitFor();
    assert((await preview.innerText()).includes('견적별 담당자 검증'));
    await page.screenshot({path:`${output}/${device}-quote-preview.png`});
    await preview.getByRole('button',{name:'미리보기 닫기',exact:true}).click();
    await bar.getByRole('button',{name:'거래처',exact:true}).click();
    assert(await page.locator('.quote-customer-picker').isVisible());
    await page.getByLabel('추가 품명',{exact:true}).fill('검증용 한 건'); await page.getByLabel('추가 수량',{exact:true}).fill('2'); await page.getByLabel('추가 판매단가',{exact:true}).fill('35000');
    await page.getByRole('button',{name:'견적표에 추가',exact:true}).click();
    assert.equal(await page.getByLabel('추가 품명',{exact:true}).inputValue(),'');
    console.log('check actions',device); await checkActions(page);
    await page.screenshot({path:`${output}/${device}-quote-actions.png`});
    if(device==='pc') {
      await page.getByRole('textbox',{name:'현장명',exact:true}).fill('검증용 견적 화면 저장');
      const savedResponse = page.waitForResponse(r => r.url().endsWith('/api/quotes') && r.request().method()==='POST');
      await bar.getByRole('button',{name:'저장',exact:true}).click();
      const saved = await (await savedResponse).json();
      await page.locator('.quote-detail-readonly').waitFor();
      assert.equal(saved.companySnapshot.contactName,'견적별 담당자 검증');
      const {execFileSync}=require('node:child_process');
      for(const ext of ['pdf','excel']) {
        const response=await context.request.get(baseURL+`/api/quotes/${saved.id}/${ext}`); assert(response.ok());
        fs.writeFileSync(`${output}/quote-output.${ext==='excel'?'xlsx':'pdf'}`,await response.body());
      }
      const text=execFileSync('pdftotext',[`${output}/quote-output.pdf`,'-'],{encoding:'utf8'});
      assert(text.includes('견적별 담당자 검증')); assert(text.includes('검증용 한 건')); assert(!text.includes('내부 원가'));
      const {unzipSync,strFromU8}=require('../node_modules/fflate');
      const files=unzipSync(fs.readFileSync(`${output}/quote-output.xlsx`));
      const sheets=Object.entries(files).filter(([k])=>/^xl\/worksheets\/sheet.*\.xml$/.test(k)).map(([,v])=>strFromU8(v)).join('');
      assert(sheets.includes('견적별 담당자 검증')); assert(sheets.includes('검증용 한 건'));
      await json(context,`/quotes/${saved.id}`,'DELETE');
      report.push('PC UI save + exported PDF text / Excel contents verified; disposable quote deleted');
    }
    if(device!=='pc') {
      const back = page.locator('.app-back button'); assert(await back.isVisible());
      await back.click();
      await page.getByRole('dialog',{name:'저장 전 나가기 확인'}).getByRole('button',{name:'계속 작성',exact:true}).click();
      await page.locator('.mobile-main').evaluate(el => {
        const t = (x) => new Touch({identifier:1,target:el,clientX:x,clientY:250});
        el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[t(5)],changedTouches:[t(5)]}));
        el.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,cancelable:true,touches:[t(150)],changedTouches:[t(150)]}));
        el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[t(150)]}));
      });
      await page.getByRole('dialog',{name:'저장 전 나가기 확인'}).getByRole('button',{name:'나가기',exact:true}).click();
      await page.getByRole('button',{name:'＋ 새 견적 작성',exact:true}).waitFor();
    }
    report.push(`${device}: home, branding, fixed quote actions at top/bottom, profile isolation, preview, single item, empty numbers`);
    await context.close();
  }
  const pwa=await launchContext(browser,{width:390,height:844},true,true); await login(pwa,'worker1'); const pp=await pageFor(pwa);
  await pp.evaluate(()=>navigator.serviceWorker.ready); await pp.reload(); await pp.locator('.home-month-grid').waitFor();
  const manifest=await (await pwa.request.get(baseURL+'/manifest.webmanifest')).json(); assert.equal(manifest.display,'standalone');assert(!manifest.name.includes('종로'));
  const keys=await pp.evaluate(async()=>{const keys=await caches.keys();const urls=[];for(const k of keys){const c=await caches.open(k);for(const r of await c.keys())urls.push(r.url)}return urls});
  assert(!keys.some(u=>/\/api\//.test(u)),'Never cache private API responses');
  await pwa.setOffline(true); await pp.goto(baseURL+'/offline-probe'); await pp.getByRole('heading',{name:'연결을 확인해 주세요'}).waitFor();
  report.push('PWA: standalone simulation, manifest, active service worker, offline fallback, no API cache'); await pwa.close();
  assert.deepEqual(errors,[],'No browser runtime errors');
  fs.writeFileSync(`${output}/report.json`,JSON.stringify(report,null,2)); console.log(report.join('\n'));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

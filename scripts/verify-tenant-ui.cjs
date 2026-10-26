// Local production Next.js routes with fake API responses. No operational Auth/DB access.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdirSync}=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const web=spawn(process.execPath,[process.cwd()+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{cwd:process.cwd()+'/apps/admin-web',stdio:'ignore'});
 let browser;
 try{
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:3100')).ok)break}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});mkdirSync('work',{recursive:true});
  const errors=[],writes=[];
  const company={slug:'jongro',name:'주식회사 종로소방',displayName:'종로소방',logoUrl:'/icons/field-helper.svg'};
  const token='A'.repeat(43),expired='B'.repeat(43);
  for(const[name,viewport]of [['pc',{width:1440,height:1000}],['tablet',{width:834,height:1112}],['mobile',{width:390,height:844}]]){
   const context=await browser.newContext({viewport});let mode='out',googleEnabled=false,emailEnabled=true;
   await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());let status=200,body={};
    if(req.method()!=='GET')writes.push({path:url.pathname,body:req.postDataJSON()});
    if(url.pathname==='/api/auth/me'){
     if(mode==='out'){status=401;body={message:'로그인이 필요합니다.'}}
     else body={user:null,company:null,access:mode,authMode:'supabase',account:{id:'fake',email:'user@example.test',providers:['email']},appBrand:{name:'현장관리'},companies:[{companyId:'co_hidden_secret',role:'worker',status:'approved',active:true,company}]};
    }else if(url.pathname==='/api/auth/config')body={demoEnabled:false,authMode:'supabase',supabaseConfigured:true,companyOnboardingEnabled:true,loginProviders:{emailEnabled,googleEnabled,kakaoEnabled:false,naverEnabled:false,phoneEnabled:false,appleEnabled:false}};
    else if(url.pathname==='/api/auth/login'){mode='pending';body={ok:true}}
    else if(url.pathname==='/api/tenant/companies/jongro')body=company;
    else if(url.pathname.startsWith('/api/tenant/companies/')){status=404;body={message:'존재하지 않는 업체입니다'}}
    else if(url.pathname==='/api/tenant/invites/'+token)body={company,role:'staff',expiresAt:'2099-01-01T00:00:00Z'};
    else if(url.pathname==='/api/tenant/invites/'+expired){status=410;body={message:'만료된 초대 링크입니다.'}}
    else if(url.pathname.startsWith('/api/tenant/invites/')){status=404;body={message:'유효하지 않은 초대 링크입니다.'}}
    else if(url.pathname==='/api/tenant/register')body={message:'가입 신청이 완료되었습니다.'};
    else if(url.pathname==='/api/tenant/company-selection'){mode='pending';body={ok:true}}
    else{status=404;body={message:'Not found'}}
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),headers:{'Cache-Control':'no-store'}});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),name+' horizontal overflow');
   const fits=async()=>assert(await page.evaluate(()=>document.documentElement.scrollHeight<=window.innerHeight+1),name+' unnecessary login scrolling');
   const noUnsupported=async()=>{assert.equal(await page.getByText(/Kakao|Kakao|카카오|Naver|네이버|Apple|휴대폰 로그인|OTP|Coming soon/).count(),0);assert.equal(await page.locator('.future-auth,.demo-login,.public-trial-entry,.login-intro').count(),0)};
   await page.goto('http://127.0.0.1:3100/');await page.getByRole('heading',{name:'현장관리 서비스',exact:true}).waitFor();
   assert.equal(await page.getByRole('button').count(),2);assert(await page.getByRole('button',{name:'로그인',exact:true}).isVisible());assert(await page.getByRole('button',{name:'새 업체 등록',exact:true}).isVisible());
   await noOverflow();await fits();await page.screenshot({path:`work/tenant-${name}-home.png`});
   await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByLabel('이메일 또는 아이디',{exact:true}).waitFor();await noUnsupported();assert.equal(await page.getByRole('link',{name:'Google로 로그인',exact:true}).count(),0);
   await page.goto('http://127.0.0.1:3100/');await page.getByRole('button',{name:'새 업체 등록',exact:true}).click();
   for(const[label,value]of [['회사명 또는 업체명','새 업체'],['이름','관리자'],['이메일','new@example.test'],['비밀번호','Fixture123!'],['휴대폰번호','01012345678']])await page.getByLabel(label,{exact:true}).fill(value);
   await noOverflow();await page.getByRole('button',{name:'업체 및 관리자 등록',exact:true}).click();await page.getByRole('status').filter({hasText:'가입 신청이 완료되었습니다.'}).waitFor();
   await page.goto('http://127.0.0.1:3100/c/jongro');await page.getByRole('heading',{name:company.name,exact:true}).waitFor();await page.getByLabel('이메일 또는 아이디',{exact:true}).waitFor();
   assert(await page.getByRole('img',{name:company.name+' 로고'}).isVisible());await noOverflow();await fits();await noUnsupported();
   assert.equal(await page.getByRole('link',{name:'Google로 로그인',exact:true}).count(),0);
   const passwordLink=page.getByRole('button',{name:'비밀번호 찾기',exact:true}),signupLink=page.getByRole('button',{name:'회원가입',exact:true});
   const a=await passwordLink.boundingBox(),b=await signupLink.boundingBox();assert(Math.abs(a.y-b.y)<2,'support links share one line');
   await page.screenshot({path:`work/tenant-${name}-company.png`});
   await passwordLink.click();await page.getByRole('status').filter({hasText:'비밀번호 재설정'}).waitFor();
   await signupLink.click();await page.getByRole('status').filter({hasText:'초대 링크를 받아 가입해 주세요.'}).waitFor();assert.equal(await page.getByLabel('회사명 또는 업체명',{exact:true}).count(),0);
   if(name==='mobile'){
    await page.reload();await page.getByLabel('비밀번호',{exact:true}).waitFor();await page.setViewportSize({width:390,height:430});await page.getByLabel('비밀번호',{exact:true}).focus();
    await page.getByRole('button',{name:'로그인',exact:true}).scrollIntoViewIfNeeded();const button=await page.getByRole('button',{name:'로그인',exact:true}).boundingBox();assert(button.y>=0&&button.y+button.height<=430);await noOverflow();await page.setViewportSize(viewport);
   }
   await page.getByLabel('이메일 또는 아이디',{exact:true}).fill('user@example.test');await page.getByLabel('비밀번호',{exact:true}).fill('Fixture123!');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('heading',{name:'관리자 승인 대기 중입니다.',exact:true}).waitFor();
   assert(writes.some(w=>w.path==='/api/auth/login'&&w.body.companySlug==='jongro'));
   mode='out';googleEnabled=true;await page.goto('http://127.0.0.1:3100/c/jongro');await page.getByRole('link',{name:'Google로 로그인',exact:true}).waitFor();await noUnsupported();await noOverflow();await fits();
   emailEnabled=false;await page.reload();await page.getByRole('link',{name:'Google로 로그인',exact:true}).waitFor();assert.equal(await page.getByLabel('비밀번호',{exact:true}).count(),0);
   googleEnabled=false;await page.reload();await page.getByRole('status').filter({hasText:'현재 로그인 서비스를 이용할 수 없습니다.'}).waitFor();assert.equal(await page.locator('.google-login,input').count(),0);
   emailEnabled=true;await page.goto('http://127.0.0.1:3100/c/missing');await page.getByRole('heading',{name:'존재하지 않는 업체입니다',exact:true}).waitFor();
   await page.goto('http://127.0.0.1:3100/join/'+token);await page.getByRole('heading',{name:'사내직원 가입 신청',exact:true}).waitFor();
   await page.getByRole('button',{name:'기존 계정으로 로그인',exact:true}).click();await page.getByLabel('비밀번호',{exact:true}).waitFor();const inviteLink=page.getByRole('link',{name:'회원가입',exact:true});assert.equal(await inviteLink.getAttribute('href'),'/join/'+token);await inviteLink.click();await page.getByRole('heading',{name:'사내직원 가입 신청',exact:true}).waitFor();
   for(const[label,value]of [['이름','직원'],['이메일','staff@example.test'],['비밀번호','Fixture123!'],['휴대폰번호','01012345678']])await page.getByLabel(label,{exact:true}).fill(value);
   assert.equal(await page.getByLabel('회사명 또는 업체명',{exact:true}).count(),0);await noOverflow();await page.getByRole('button',{name:'가입 신청',exact:true}).click();await page.getByRole('status').filter({hasText:'가입 신청이 완료되었습니다.'}).waitFor();
   await page.goto('http://127.0.0.1:3100/join/'+expired);await page.getByRole('heading',{name:'만료된 초대 링크입니다.',exact:true}).waitFor();
   await page.goto('http://127.0.0.1:3100/join/invalid');await page.getByRole('heading',{name:'유효하지 않은 초대 링크입니다.',exact:true}).waitFor();
   mode='choose_company';await page.goto('http://127.0.0.1:3100/');await page.getByRole('heading',{name:'접속할 업체를 선택해 주세요.',exact:true}).waitFor();assert(!(await page.locator('body').innerText()).includes('co_hidden_secret'));
   await page.getByRole('button').filter({hasText:company.name}).click();await page.getByRole('heading',{name:'관리자 승인 대기 중입니다.',exact:true}).waitFor();await noOverflow();
   await context.close();console.log(name+': compact home/login, branding, email, help/signup, provider flags, invitation/picker and mobile layout passed');
  }
  assert(writes.some(w=>w.body?.kind==='company'));assert(writes.some(w=>w.body?.kind==='invite'&&w.body.inviteToken===token));assert(writes.some(w=>w.path==='/api/tenant/company-selection'&&w.body.companyId==='co_hidden_secret'));
  assert(writes.filter(w=>w.path==='/api/tenant/register').every(w=>!('company_id'in w.body)&&!('companyId'in w.body)&&!('role'in w.body)));assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();web.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1});

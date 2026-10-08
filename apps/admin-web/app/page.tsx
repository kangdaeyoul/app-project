'use client';
import { useEffect, useState } from 'react';
import { Company, DEFAULT_COMPANY, MENU_ITEMS, Dashboard, isSiteOnDate } from '@jongno/shared';
import InstructionsPanel,{InstructionSiteView} from './instructions-panel';
import QuotesPanel from './quotes-panel';
import FinancePanel from './finance-panels';
import MaterialManagementPanel from "./material-management-panel";
import ExpensesPanel from './expenses-panel';
import DailyWorkPanel from './daily-work-panel';
import WorkersPanel from './workers-panel';
import SitesPanel from './sites-panel';
import SchedulePanel from './schedule-panel';
import AfterServicePanel from './after-service-panel';
import FieldHelper from './field-helper';
const money = (amount: number) => new Intl.NumberFormat('ko-KR').format(amount) + '원';
const initialMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
export default function Home() {
  const [company, setCompany] = useState<Company>(DEFAULT_COMPANY);
  useEffect(() => { const controller = new AbortController(); fetch('/api/company/current', {signal: controller.signal}).then(r => {if(!r.ok)throw Error();return r.json();}).then(v=>setCompany(v.company)).catch(()=>{}); return ()=>controller.abort(); }, []);
  const companyAppName = `${company.displayName} 통합 현장관리`;
  const [instructionUnread,setInstructionUnread]=useState(0);
  useEffect(()=>{const refresh=()=>fetch('/api/work-instructions/notifications').then(r=>r.ok?r.json():[]).then(rows=>setInstructionUnread(rows.filter((n:{readAt:string|null})=>!n.readAt).length)).catch(()=>{});refresh();const timer=setInterval(refresh,15000);window.addEventListener('instructions-changed',refresh);return()=>{clearInterval(timer);window.removeEventListener('instructions-changed',refresh)}},[]);
  const [menu, setMenu] = useState<string>('홈');
  const [siteNavigation, setSiteNavigation] = useState(0);
  const [isWorker,setIsWorker]=useState(false);
  const [initialAsId,setInitialAsId]=useState<string|undefined>();
  useEffect(()=>{fetch("/api/after-service/options").then(r=>r.json()).then(o=>{if(o.isWorker){setIsWorker(true);setMenu("A/S 관리")}}).catch(()=>{})},[]);
  const [asAlerts,setAsAlerts]=useState<import("@jongno/shared").AfterServiceView[]>([]);
  const [quoteId,setQuoteId]=useState<string|undefined>();
  useEffect(()=>{fetch("/api/after-service").then(r=>r.json()).then(r=>setAsAlerts(Array.isArray(r)?r:[])).catch(()=>{})},[menu]);
  const [workerId,setWorkerId]=useState<string|undefined>();
  const [siteId, setSiteId] = useState<string | undefined>();
  const openSite = (id: string) => { setSiteId(id); setMenu('현장'); };
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    fetch(`/api/dashboard?month=${month}`, { signal: controller.signal }).then(response => { if (!response.ok) throw new Error('API 응답 오류'); return response.json(); }).then(setData).catch(e => { if (e.name !== 'AbortError') setError('데이터를 불러올 수 없습니다. API 서버 실행 상태를 확인해 주세요.'); });
    return () => controller.abort();
  }, [month, retry]);
  const changeMonth = (offset: number) => {
    const [year, m] = month.split('-').map(Number); const date = new Date(year, m - 1 + offset, 1);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };
  const [year, m] = month.split('-').map(Number);
  const first = new Date(year, m - 1, 1).getDay();
  const days = new Date(year, m, 0).getDate();
  const cells = Math.ceil((first + days) / 7) * 7;
  return <div className="shell">
    <aside><div className="brand"><span className="brand-icon">{company.logoUrl ? <img src={company.logoUrl} alt={`${company.displayName} 로고`} style={{maxWidth:32,maxHeight:32}}/> : company.displayName === DEFAULT_COMPANY.displayName ? "J" : company.displayName.slice(0,1)}</span><div>{company.displayName}<small>통합 현장관리</small></div></div><div className="nav-label">WORKSPACE</div><nav aria-label="주 메뉴">{(isWorker?MENU_ITEMS.filter(i=>["A/S 관리","작업진행자 스케줄","알림센터"].includes(i)):MENU_ITEMS).map((item, i) => <button key={item} onClick={() => { setInitialAsId(undefined);setSiteId(undefined); setWorkerId(undefined);setQuoteId(undefined); setSiteNavigation(v => v + 1); setMenu(item); }} aria-current={menu === item ? 'page' : undefined} className={menu === item ? 'active' : ''}><span className="nav-icon">{['▦','▤','▧','♙','◷','↺','♧','☷','▣','₩','↗','▥'][MENU_ITEMS.indexOf(item)]}</span>{item}{item==='알림센터'&&instructionUnread>0&&<b className="notification-count">{instructionUnread}</b>}{menu === item && <span className="nav-dot"/>}</button>)}</nav><div className="aside-bottom"><span className="online"/> 샘플 환경<small>관리자 웹 · v0.1</small></div></aside>
    <div className="workspace"><header><span>{companyAppName}</span><div><span className="sample-tag">SAMPLE DATA</span><span className="avatar">관</span> 관리자</div></header>
    <main><div className="page-heading"><div><div className="eyebrow">OVERVIEW / {menu}</div><h1>{menu === '홈' ? '현장의 흐름을 한눈에' : menu === '작업지시 현장' ? '현장 상세' : menu}</h1><p>{menu === '홈' ? '현장 일정부터 계약과 정산까지, 이번 달의 업무 현황입니다.' : menu === '작업지시 현장' ? '현장정보와 본인 작업일정, 작업지시를 확인하세요.' : menu === '알림센터' ? '현장과 A/S 작업지시, 중요 알림을 확인하세요.' : menu === 'A/S 관리' ? '공사 후 요청 접수, 처리기록과 결과확인을 관리하세요.' : menu === '작업진행자 스케줄' ? '작업진행자별 일정과 가용상태를 확인하고 현장을 배정하세요.' : menu === '견적' ? '고객 견적과 내부 원가, 승인 후 계약전환을 관리하세요.' : menu === '현장' ? '현장 정보와 공사 진행 현황을 관리하세요.' : menu === '작업진행자' ? '작업진행자 정보와 일정, 근무 상태를 관리하세요.' : menu === '자재·경비' ? '현장별 구매·지출과 작업진행자 대납을 관리하세요.' : menu === '정산' ? '현장별 수금·미수와 작업진행자 지급, 현장손익을 관리하세요.' : menu === '일일작업' ? '현장별 일일작업, 사용자재와 전후사진을 관리하세요.' : '다음 단계에서 상세 업무 기능을 연결할 예정입니다.'}</p></div><span className="date-pill">기준일 {data?.today ?? '—'} · 서울</span></div>
    <div className="notice"><span>ⓘ</span> 샘플 데이터는 API 서버가 실행되는 동안 유지됩니다. 서버 재시작 시 초기화됩니다.</div>
    {menu === '알림센터' ? <InstructionsPanel onOpen={(s,a)=>{if(a){setInitialAsId(a);setMenu('A/S 관리')}else{setSiteId(s);setMenu(isWorker?'작업지시 현장':'현장')}}}/> : menu === '작업지시 현장' ? <InstructionSiteView siteId={siteId!}/> : menu === 'A/S 관리' ? <AfterServicePanel initialAsId={initialAsId} onChanged={()=>setRetry(v=>v+1)} onOpenQuote={id=>{setQuoteId(id);setMenu('견적');setSiteNavigation(v=>v+1)}}/> : menu === '작업진행자 스케줄' ? <SchedulePanel onChanged={()=>setRetry(v=>v+1)} onOpenSite={openSite} onOpenWorker={id=>{setWorkerId(id);setMenu('작업진행자');setSiteNavigation(v=>v+1)}}/> : menu === '견적' ? <QuotesPanel initialQuoteId={quoteId} key={siteNavigation} onChanged={()=>setRetry(v=>v+1)} onOpenSite={openSite}/> : menu === '정산' ? <FinancePanel key={siteNavigation} onChanged={()=>setRetry(v=>v+1)}/> : menu === '자재·경비' ? <><MaterialManagementPanel key={`materials-${siteNavigation}`}/><ExpensesPanel key={siteNavigation} onChanged={()=>setRetry(v=>v+1)}/></> : menu === '일일작업' ? <DailyWorkPanel key={siteNavigation}/> : menu === '작업진행자' ? <WorkersPanel initialWorkerId={workerId} key={siteNavigation} onChanged={()=>setRetry(v=>v+1)}/> : menu === '현장' ? <SitesPanel key={`${siteId ?? 'list'}-${siteNavigation}`} initialSiteId={siteId} onChanged={() => setRetry(v => v + 1)}/> : error ? <div className="error" role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>다시 시도</button></div> : !data ? <p role="status">현장 데이터를 불러오는 중입니다…</p> : menu !== '홈' && menu !== '현장' ? <section className="panel placeholder"><h2>{menu} 관리</h2><p>이 메뉴의 등록·수정·검색 기능은 아직 구현되지 않았습니다.</p><button onClick={() => setMenu('홈')}>대시보드로 돌아가기</button></section> : <>
    {menu === '홈' && <><FieldHelper pose="greeting"/><div className="as-alerts">{[['오늘 예정 A/S',asAlerts.filter(a=>a.plannedDate===data.today&&!['처리완료','종결'].includes(a.status)).length],['미배정 A/S',asAlerts.filter(a=>!a.managerId&&!['처리완료','종결'].includes(a.status)).length],['긴급 A/S',asAlerts.filter(a=>a.urgent&&!['처리완료','종결'].includes(a.status)).length],['처리 지연 A/S',asAlerts.filter(a=>a.delayed).length],['재확인필요 A/S',asAlerts.filter(a=>a.status==='재확인필요').length]].map(([label,count])=><button key={label} onClick={()=>setMenu('A/S 관리')}><span>{label}</span><strong>{count}</strong></button>)}</div><div className="stats">{[['오늘 현장', data.summary.todaySites, '오늘 예정된 현장'], ['진행중',data.summary.inProgress,'작업 진행 현장'],['완료',data.summary.completed,'이번 달 완료 현장'],['미배정',data.summary.unassigned,'담당자 배정 필요']].map(([label,value,hint],i) => <section className="stat" key={label}><div><span>{label}</span><span className={`stat-symbol tone-${i}`}>{['◷','↗','✓','!'][i]}</span></div><strong>{value}<small>개</small></strong><p>{hint}</p></section>)}</div>
    <div className="stats tax-warnings">{[['세금계산서 미발행',data.summary.taxWarnings.salesUnissued],['세금계산서 미수취',data.summary.taxWarnings.purchasesUnreceived],['증빙없는 지출',data.summary.taxWarnings.noEvidence]].map(([label,count])=><section className="stat" key={label}><span>{label}</span><strong className="orange">{count}<small>건</small></strong><p>조회 월 현장 기준</p></section>)}</div>
    <div className="finance">{[['월 계약매출',data.summary.contractRevenue],['수금액',data.summary.collected],['미수금',data.summary.receivables],['작업진행자 미지급액',data.summary.unpaidWorkers],['총 현장지출',data.summary.totalExpenses],['현장차익',data.summary.siteProfit]].map(([label,value],i) => <section key={label}><span>{label}</span><strong className={i === 2 ? 'orange' : ''}>{money(Number(value))}</strong><small>{month} 기준</small></section>)}</div>
    <p className="finance-note">조회 월과 공사기간이 겹치는 현장의 원장 누계입니다. 현장차익에는 회사 전체 세금·보험·고정비가 반영되지 않았습니다.</p>
    <div className="dashboard-grid"><section className="panel calendar-panel"><div className="panel-title"><div><h2>월간 현장 일정</h2><p>날짜별 작업 현황을 확인하세요</p></div><div className="month-control"><button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{year}년 {m}월</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button></div></div><div className="calendar">{['일','월','화','수','목','금','토'].map(d => <div className="weekday" key={d}>{d}</div>)}{Array.from({length:cells},(_,i) => { const day = i - first + 1; const valid = day > 0 && day <= days; const date = `${month}-${String(day).padStart(2,'0')}`; return <div className={`day ${valid ? '' : 'muted'} ${date === data.today ? 'today' : ''}`} key={i}>{valid && <><span className="day-number">{day}</span>{data.sites.filter(s => isSiteOnDate(s, date)).map(s => <div className={`event ${s.status === '완료' ? 'done' : s.status === '미배정' ? 'unassigned' : ''}`} title={`${s.status} · ${s.name}`} key={s.id} onClick={() => openSite(s.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSite(s.id); } }}>[{s.status}] {s.name}</div>)}{asAlerts.filter(a=>a.plannedDate===date).map(a=><button className={`event ${['처리완료','종결'].includes(a.status)?'done':''}`} style={a.urgent?{color:'#b91c1c',background:'#fef2f2'}:undefined} key={a.id} onClick={()=>{setInitialAsId(a.id);setMenu('A/S 관리')}}>[A/S] {a.urgent?'긴급 · ':''}{a.siteName}</button>)}</>}</div>; })}</div><div className="legend"><span>● 진행중</span><span>● 완료</span><span>● 미배정</span></div></section>
    <section className="panel today-panel"><div className="panel-title"><div><h2>오늘 현장 <span className="count">{data.summary.todaySites}</span></h2><p>{data.today}</p></div></div>{data.sites.filter(s => isSiteOnDate(s, data.today)).map(site => <article className="today-site" key={site.id}><span className={`badge ${site.status === '미배정' ? 'warning' : ''}`}>{site.status}</span><h3><button className="text-button" onClick={() => openSite(site.id)}>{site.name}</button></h3><p>{site.address}</p><div>작업진행자 <strong>{site.manager ?? '배정 대기'}</strong></div></article>)}{!data.summary.todaySites && <p className="empty">오늘 예정된 현장이 없습니다.</p>}<div className="today-footer">현장명을 누르면 상세정보를 확인할 수 있습니다.</div></section></div></>}
    <section className="panel site-list"><div className="panel-title"><div><h2>이번 달 현장</h2><p>총 {data.sites.length}개 현장 · 샘플 데이터</p></div></div><div className="table-scroll"><table><thead><tr><th>현장명</th><th>작업일</th><th>작업진행자</th><th>상태</th><th>계약금액</th></tr></thead><tbody>{data.sites.map(s => <tr key={s.id}><td><button className="text-button" onClick={() => openSite(s.id)}>{s.name}</button><small>{s.address}</small></td><td>{s.startDate}</td><td>{s.manager ?? '미배정'}</td><td><span className={`badge ${s.status === '미배정' ? 'warning' : s.status === '완료' ? 'success' : ''}`}>{s.status}</span></td><td>{money(s.contractAmount)}</td></tr>)}</tbody></table></div></section>
    </>}
    <footer>{companyAppName} <span>{company.output.footer}</span></footer></main></div></div>;
}

'use client';
import { useEffect, useState } from 'react';
import { APP_NAME, MENU_ITEMS, Dashboard } from '@jongno/shared';
const money = (amount: number) => new Intl.NumberFormat('ko-KR').format(amount) + '원';
const initialMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
export default function Home() {
  const [menu, setMenu] = useState<string>('홈');
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
    <aside><div className="brand"><span className="brand-icon">J</span><div>종로소방<small>통합 현장관리</small></div></div><div className="nav-label">WORKSPACE</div><nav aria-label="주 메뉴">{MENU_ITEMS.map((item, i) => <button key={item} onClick={() => setMenu(item)} aria-current={menu === item ? 'page' : undefined} className={menu === item ? 'active' : ''}><span className="nav-icon">{['▦','▤','▧','♙','☷','▣','₩','↗','▥'][i]}</span>{item}{menu === item && <span className="nav-dot"/>}</button>)}</nav><div className="aside-bottom"><span className="online"/> 샘플 환경<small>관리자 웹 · v0.1</small></div></aside>
    <div className="workspace"><header><span>{APP_NAME}</span><div><span className="sample-tag">SAMPLE DATA</span><span className="avatar">관</span> 관리자</div></header>
    <main><div className="page-heading"><div><div className="eyebrow">OVERVIEW / {menu}</div><h1>{menu === '홈' ? '현장의 흐름을 한눈에' : menu}</h1><p>{menu === '홈' ? '현장 일정부터 계약과 정산까지, 이번 달의 업무 현황입니다.' : '다음 단계에서 상세 업무 기능을 연결할 예정입니다.'}</p></div><span className="date-pill">기준일 {data?.today ?? '—'} · 서울</span></div>
    <div className="notice"><span>ⓘ</span> 현재 화면은 샘플 데이터입니다. 로그인, 데이터베이스 및 NAS는 연결되지 않았습니다.</div>
    {error ? <div className="error" role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>다시 시도</button></div> : !data ? <p role="status">현장 데이터를 불러오는 중입니다…</p> : menu !== '홈' && menu !== '현장' ? <section className="panel placeholder"><h2>{menu} 관리</h2><p>이 메뉴의 등록·수정·검색 기능은 아직 구현되지 않았습니다.</p><button onClick={() => setMenu('홈')}>대시보드로 돌아가기</button></section> : <>
    {menu === '홈' && <><div className="stats">{[['오늘 현장', data.summary.todaySites, '오늘 예정된 현장'], ['진행중',data.summary.inProgress,'작업 진행 현장'],['완료',data.summary.completed,'이번 달 완료 현장'],['미배정',data.summary.unassigned,'담당자 배정 필요']].map(([label,value,hint],i) => <section className="stat" key={label}><div><span>{label}</span><span className={`stat-symbol tone-${i}`}>{['◷','↗','✓','!'][i]}</span></div><strong>{value}<small>개</small></strong><p>{hint}</p></section>)}</div>
    <div className="finance">{[['월 계약매출',data.summary.contractRevenue],['수금액',data.summary.collected],['미수금',data.summary.receivables],['작업진행자 미지급액',data.summary.unpaidWorkers]].map(([label,value],i) => <section key={label}><span>{label}</span><strong className={i === 2 ? 'orange' : ''}>{money(Number(value))}</strong><small>{month} 기준</small></section>)}</div>
    <div className="dashboard-grid"><section className="panel calendar-panel"><div className="panel-title"><div><h2>월간 현장 일정</h2><p>날짜별 작업 현황을 확인하세요</p></div><div className="month-control"><button aria-label="이전 달" onClick={() => changeMonth(-1)}>‹</button><strong>{year}년 {m}월</strong><button aria-label="다음 달" onClick={() => changeMonth(1)}>›</button></div></div><div className="calendar">{['일','월','화','수','목','금','토'].map(d => <div className="weekday" key={d}>{d}</div>)}{Array.from({length:cells},(_,i) => { const day = i - first + 1; const valid = day > 0 && day <= days; const date = `${month}-${String(day).padStart(2,'0')}`; return <div className={`day ${valid ? '' : 'muted'} ${date === data.today ? 'today' : ''}`} key={i}>{valid && <><span className="day-number">{day}</span>{data.sites.filter(s => s.date === date).map(s => <div className={`event ${s.status === '완료' ? 'done' : s.status === '미배정' ? 'unassigned' : ''}`} title={s.name} key={s.id}>{s.name}</div>)}</>}</div>; })}</div><div className="legend"><span>● 진행중</span><span>● 완료</span><span>● 미배정</span></div></section>
    <section className="panel today-panel"><div className="panel-title"><div><h2>오늘 현장 <span className="count">{data.summary.todaySites}</span></h2><p>{data.today}</p></div></div>{data.sites.filter(s => s.date === data.today).map(site => <article className="today-site" key={site.id}><span className={`badge ${site.status === '미배정' ? 'warning' : ''}`}>{site.status}</span><h3>{site.name}</h3><p>{site.address}</p><div>작업진행자 <strong>{site.manager ?? '배정 대기'}</strong></div></article>)}{!data.summary.todaySites && <p className="empty">오늘 예정된 현장이 없습니다.</p>}<div className="today-footer">현장 상세 기능은 다음 단계에서 제공됩니다.</div></section></div></>}
    <section className="panel site-list"><div className="panel-title"><div><h2>{menu === '현장' ? '현장 목록' : '이번 달 현장'}</h2><p>총 {data.sites.length}개 현장 · 샘플 데이터</p></div></div><div className="table-scroll"><table><thead><tr><th>현장명</th><th>작업일</th><th>작업진행자</th><th>상태</th><th>계약금액</th></tr></thead><tbody>{data.sites.map(s => <tr key={s.id}><td><strong>{s.name}</strong><small>{s.address}</small></td><td>{s.date}</td><td>{s.manager ?? '미배정'}</td><td><span className={`badge ${s.status === '미배정' ? 'warning' : s.status === '완료' ? 'success' : ''}`}>{s.status}</span></td><td>{money(s.contractAmount)}</td></tr>)}</tbody></table></div></section>
    </>}
    <footer>종로소방 통합 현장관리 <span>안전한 현장, 체계적인 관리</span></footer></main></div></div>;
}

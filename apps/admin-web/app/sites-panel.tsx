'use client';

import { useEffect, useState } from 'react';
import { SITE_STATUSES, Site, SiteInput, WorkerSummary } from '@jongno/shared';

const money = (value: number) => new Intl.NumberFormat('ko-KR').format(value) + '원';
const tabs = ['개요', '일정', '일일작업', '사진', '자재·경비', '수금', '작업진행자 정산', '파일'] as const;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const emptyInput = (): SiteInput => ({ name: '', client: '', address: '', contactName: '', phone: '', description: '', startDate: today(), endDate: '', contractAmount: 0, manager: null, managerId: null, status: '미배정' });
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/sites${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : '요청을 처리하지 못했습니다.');
  return body;
}
function Badge({ status }: { status: Site['status'] }) {
  return <span className={`badge ${status === '미배정' ? 'warning' : status === '완료' ? 'success' : ''}`}>{status}</span>;
}
export default function SitesPanel({ onChanged, initialSiteId }: { onChanged: () => void; initialSiteId?: string }) {
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [workersReady, setWorkersReady] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [selected, setSelected] = useState<Site | null>(null);
  const [form, setForm] = useState<SiteInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<typeof tabs[number]>('개요');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/workers', {signal:controller.signal}).then(r=>{if(!r.ok)throw Error('작업진행자 목록을 불러오지 못했습니다.');return r.json();}).then(w=>{setWorkers(w);setWorkersReady(true);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return ()=>controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api<Site[]>('', { signal: controller.signal }).then(setSites).catch(e => { if (e.name !== 'AbortError') setError('현장 목록을 불러오지 못했습니다. API 연결을 확인해 주세요.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!initialSiteId) return;
    const controller = new AbortController();
    api<Site>(`/${encodeURIComponent(initialSiteId)}`, { signal: controller.signal }).then(site => { setSelected(site); setForm(null); setTab('개요'); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [initialSiteId]);
  async function openSite(id: string) {
    setError(''); setLoading(true); setMessage('');
    try { setSelected(await api<Site>(`/${encodeURIComponent(id)}`)); setTab('개요'); }
    catch (e) { setError(e instanceof Error ? e.message : '조회 실패'); }
    finally { setLoading(false); }
  }
  function edit(site?: Site) {
    setEditingId(site?.id ?? null);
    setForm(site ? { name: site.name, client: site.client, address: site.address, contactName: site.contactName, phone: site.phone, description: site.description, startDate: site.startDate, endDate: site.endDate, contractAmount: site.contractAmount, manager: site.manager, managerId: site.managerId ?? null, status: site.status } : emptyInput());
    setError(''); setMessage('');
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form || saving) return;
    setSaving(true); setError('');
    try {
      const site = await api<Site>(editingId ? `/${encodeURIComponent(editingId)}` : '', { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setSelected(site); setForm(null); setTab('개요'); setMessage(editingId ? '현장 정보를 수정했습니다.' : '새 현장을 등록했습니다.'); setRevision(v => v + 1); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  const filtered = sites.filter(s => (!status || s.status === status) && `${s.name} ${s.client} ${s.address}`.toLowerCase().includes(search.toLowerCase()));
  function textField(key: 'name' | 'client' | 'address' | 'contactName' | 'phone' | 'startDate' | 'endDate', label: string, type = 'text', required = false) {
    return <label key={key}>{label}{required && <span className="required"> *</span>}<input type={type} value={form![key]} required={required} maxLength={300} min={key === 'endDate' ? form!.startDate : undefined} onChange={e => setForm({ ...form!, [key]: e.target.value })}/></label>;
  }
  return <div className="sites-workspace">
    {error && <div role="alert" className="error">{error} {!form && <button onClick={() => setRevision(v => v + 1)}>다시 시도</button>}</div>}
    {message && <p className="save-message" role="status">✓ {message}</p>}
    {form ? <section className="panel site-form"><div className="panel-title"><div><h2>{editingId ? '현장 정보 수정' : '새 현장 등록'}</h2><p>현장명과 시작일만 필수입니다. 나머지는 나중에 입력해도 됩니다.</p></div></div><form onSubmit={save}><fieldset disabled={saving}><div className="form-grid">
      {textField('name', '현장명', 'text', true)}{textField('client', '거래처')}{textField('address', '주소')}{textField('contactName', '현장 담당자')}{textField('phone', '연락처', 'tel')}
      <label className="full-width">공사내용<textarea value={form.description} maxLength={5000} rows={3} onChange={e => setForm({ ...form, description: e.target.value })}/></label>
      {textField('startDate', '시작일', 'date', true)}{textField('endDate', '종료예정일', 'date')}
      <label>VAT 포함 공사금액<input type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" value={form.contractAmount} onChange={e => setForm({ ...form, contractAmount: Number(e.target.value) })}/><small>원 단위 · 미정인 경우 0원</small></label>
      <label>대표 작업진행자<select aria-label="대표 작업진행자" disabled={!workersReady} value={form.managerId ?? ''} onChange={e => setForm({ ...form, managerId: e.target.value || null, manager: workers.find(w=>w.id===e.target.value)?.displayName ?? null })}><option value="">미배정</option>{form.managerId && !workers.some(w=>w.id===form.managerId) && <option value={form.managerId}>{form.manager} (삭제됨 · 기존 배정 유지)</option>}{workers.map(w=><option value={w.id} key={w.id}>{w.displayName} · {w.role || '역할 미입력'}</option>)}</select>{!workersReady&&<small>작업진행자 목록을 불러오는 중입니다.</small>}</label>
      <label>진행상태<select aria-label="진행상태" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Site['status'] })}>{SITE_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label>
    </div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => { setForm(null); setError(''); }}>취소</button><button className="primary-button" type="submit">{saving ? '저장 중…' : '저장'}</button></div></fieldset></form></section> : selected ? <>
      <div className="site-toolbar"><button className="secondary-button" onClick={() => { setSelected(null); setMessage(''); setError(''); }}>← 현장 목록</button><button className="primary-button" onClick={() => edit(selected)}>현장 수정</button></div>
      <section className="panel site-basic"><div className="panel-title"><div><p>{selected.id}</p><h2>{selected.name}</h2></div><Badge status={selected.status}/></div><dl className="info-grid">
        {Object.entries({ '거래처': selected.client, '주소': selected.address, '현장 담당자': selected.contactName, '연락처': selected.phone, '공사내용': selected.description, '공사일정': `${selected.startDate} ~ ${selected.endDate || '종료예정일 미정'}`, '대표 작업진행자': selected.manager || '미배정', 'VAT 포함 공사금액': money(selected.contractAmount) }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '미입력'}</dd></div>)}
      </dl></section>
      <section className="panel site-tabs"><div className="tab-list" role="tablist" aria-label="현장 상세">{tabs.map(t => <button key={t} role="tab" id={`tab-${tabs.indexOf(t)}`} aria-controls="site-tab-panel" aria-selected={tab === t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="tab-content" id="site-tab-panel" role="tabpanel" aria-labelledby={`tab-${tabs.indexOf(tab)}`}>
        <h3>{tab}</h3>
        {tab === '개요' ? <><p className="description">{selected.description || '공사내용을 입력해 주세요.'}</p><div className="detail-totals"><div>공사금액<strong>{money(selected.contractAmount)}</strong></div><div>입금액<strong>{money(selected.collectedAmount)}</strong></div><div>미수금<strong className="orange">{money(selected.contractAmount - selected.collectedAmount)}</strong></div></div></> : tab === '일정' ? <dl className="info-grid"><div><dt>시작일</dt><dd>{selected.startDate}</dd></div><div><dt>종료예정일</dt><dd>{selected.endDate || '미정'}</dd></div><div><dt>진행상태</dt><dd>{selected.status}</dd></div></dl> : tab === '수금' ? <><p>입금액 {money(selected.collectedAmount)} · 미수금 {money(selected.contractAmount - selected.collectedAmount)}</p><p>샘플 누계입니다. 개별 수금 내역 등록은 다음 단계에서 제공합니다.</p></> : tab === '작업진행자 정산' ? <><p>대표 작업진행자: {selected.manager || '미배정'}</p><p>미지급액 {money(selected.unpaidWorkerAmount)}</p><p>정산 내역 등록은 다음 단계에서 제공합니다.</p></> : <div className="empty">등록된 {tab} 내역이 없습니다. {tab} 등록 및 첨부 기능은 다음 단계에서 제공합니다.</div>}
      </div></section>
    </> : <section className="panel site-list"><div className="panel-title"><div><h2>현장 목록</h2><p>총 {filtered.length}개 현장 · 전체 기간</p></div><button className="primary-button" onClick={() => { setSelected(null); edit(); }}>＋ 새 현장 등록</button></div><div className="site-filters"><label>현장 검색<input type="search" placeholder="현장명, 거래처, 주소" value={search} onChange={e => setSearch(e.target.value)}/></label><label>진행상태 필터<select aria-label="진행상태 필터" value={status} onChange={e => setStatus(e.target.value)}><option value="">전체 상태</option>{SITE_STATUSES.map(s => <option key={s}>{s}</option>)}</select></label></div>
      {loading ? <p className="empty" role="status">현장을 불러오는 중입니다…</p> : <div className="table-scroll"><table><thead><tr>{['현장명','거래처','주소','공사내용','공사일정','대표 작업진행자','공사금액','입금액','미수금','진행상태'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{filtered.map(s => <tr key={s.id}><td><button className="text-button" onClick={() => openSite(s.id)}>{s.name}</button></td><td>{s.client || '미입력'}</td><td>{s.address || '미입력'}</td><td className="description-cell">{s.description || '미입력'}</td><td>{s.startDate}<small>~ {s.endDate || '미정'}</small></td><td>{s.manager || '미배정'}</td><td>{money(s.contractAmount)}</td><td>{money(s.collectedAmount)}</td><td className="orange">{money(s.contractAmount - s.collectedAmount)}</td><td><Badge status={s.status}/></td></tr>)}</tbody></table>{!filtered.length && <p className="empty">조건에 맞는 현장이 없습니다.</p>}</div>}
    </section>}
  </div>;
}

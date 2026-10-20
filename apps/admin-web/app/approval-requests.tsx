"use client";
import {useEffect,useRef,useState} from 'react';
import {CurrentUser,UserPermission,UserRole} from '@jongro/shared';
import {authApi,ROLE_LABELS,useAuth} from './auth-provider';
import type {UserOptions} from './users-panel';
import {permissionLabels} from './user-permissions';
const providerNames:Record<string,string>={email:'이메일',google:'Google',kakao:'Kakao',naver:'Naver',apple:'Apple'};
function ApplicantInfo({user}:{user:CurrentUser}){
  const joined=user.appliedAt && !Number.isNaN(Date.parse(user.appliedAt))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(user.appliedAt)):'—';
  return <dl className="applicant-info"><dt>이름</dt><dd>{user.displayName || user.name || '미입력'}</dd><dt>이메일</dt><dd>{user.email}</dd><dt>휴대전화</dt><dd>{user.phone || "미입력"}</dd><dt>희망 역할</dt><dd>{user.requestedRole?ROLE_LABELS[user.requestedRole]:"미입력"} · 승인 참고용</dd><dt>가입일</dt><dd>{joined}</dd><dt>신청 회사명</dt><dd>{user.requestedCompany || '미입력'}</dd><dt>로그인 제공자</dt><dd>{user.authProviders?.length?user.authProviders.map(p=>providerNames[p]??p).join(' · '):'확인 필요 · 제공자 조회 설정을 확인하세요'}</dd><dt>현재 상태</dt><dd>승인대기</dd></dl>;
}
export function ApprovalRequests({rows,options,onChanged}:{rows:CurrentUser[];options:UserOptions;onChanged:()=>Promise<void>}){
  const pending=rows.filter(u=>u.approvalStatus==='승인대기');
  const [selected,setSelected]=useState<{user:CurrentUser;mode:'approve'|'detail'}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const section=useRef<HTMLElement>(null);
  useEffect(()=>{if(sessionStorage.getItem('focus-approval-requests')==='true'){sessionStorage.removeItem('focus-approval-requests');section.current?.scrollIntoView({block:'start'});section.current?.focus();}},[]);
  async function changed(){await onChanged();window.dispatchEvent(new Event('memberships-updated'));}
  async function reject(user:CurrentUser){
    if(busy || !confirm(`${user.email}님의 가입 요청을 거절할까요? Auth 계정은 삭제하지 않습니다.`))return;
    setBusy(true);setError('');setNotice('');
    try{await authApi('/users/'+user.id+'/approval',{method:'POST',body:JSON.stringify({action:'reject'})});setNotice('가입 요청을 거절했습니다. Auth 계정은 유지됩니다.');await changed();}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <section id="approval-requests" ref={section} tabIndex={-1} className="approval-requests" aria-labelledby="approval-requests-title">
    <h3 id="approval-requests-title">가입 승인 요청 <span className="approval-count">{pending.length}건</span></h3>
    <p>신청 회사와 본인을 확인한 뒤 소속 회사·역할·접근 권한을 지정하세요.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {pending.length===0?<p>승인대기 중인 가입 요청이 없습니다.</p>:<div className="approval-list">{pending.map(user=><article className="approval-request" key={user.id} aria-label={`${user.email} 가입 요청`}>
      <ApplicantInfo user={user}/><div className="approval-actions"><button className="primary" disabled={busy} onClick={()=>setSelected({user,mode:'approve'})}>승인하기</button><button disabled={busy} onClick={()=>void reject(user)}>거절</button><button disabled={busy} onClick={()=>setSelected({user,mode:'detail'})}>상세보기</button></div>
    </article>)}</div>}
    {selected&&<ApprovalDialog key={selected.user.id+selected.mode} user={selected.user} mode={selected.mode} options={options} onClose={()=>setSelected(null)} onApprove={()=>setSelected({...selected,mode:'approve'})} onSaved={async()=>{setSelected(null);setNotice('가입 승인을 완료했습니다. 사용자는 승인 상태 다시 확인으로 업무를 시작할 수 있습니다.');await changed();}}/>}
  </section>;
}
function ApprovalDialog({user,mode,options,onClose,onApprove,onSaved}:{user:CurrentUser;mode:'approve'|'detail';options:UserOptions;onClose:()=>void;onApprove:()=>void;onSaved:()=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [companyId,setCompanyId]=useState(''),[role,setRole]=useState<UserRole|''>(''),[workerId,setWorkerId]=useState(''),[siteIds,setSiteIds]=useState<string[]>([]),[permissions,setPermissions]=useState<UserPermission[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  async function approve(e:React.FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{await authApi('/users/'+user.id+'/approval',{method:'POST',body:JSON.stringify({action:'approve',companyId,role,workerId:role==='worker'?workerId:null,siteIds,permissions})});await onSaved();}catch(e){setError((e as Error).message);setBusy(false)}
  }
  return <dialog className="approval-dialog" ref={dialog} aria-labelledby="approval-dialog-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <h3 id="approval-dialog-title">{mode==='approve'?'가입 승인 설정':'가입 요청 상세'}</h3><ApplicantInfo user={user}/>
    {mode==='detail'?<div className="approval-actions"><button onClick={onClose}>닫기</button><button className="primary" onClick={onApprove}>승인하기</button></div>:<form onSubmit={approve}>
      <div className="form-grid"><label>소속 회사<select aria-label="소속 회사" required value={companyId} onChange={e=>setCompanyId(e.target.value)}><option value="">소속 회사 선택</option>{options.companies.map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
      <label>역할<select aria-label="역할" required value={role} onChange={e=>{setRole(e.target.value as UserRole);setWorkerId('');setPermissions([]);setSiteIds([]);}}><option value="">역할 선택</option>{Object.entries(ROLE_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {role==='worker'&&<label>작업진행자 연결<select aria-label="작업진행자 연결" required value={workerId} onChange={e=>setWorkerId(e.target.value)}><option value="">작업진행자 선택</option>{options.workers.map(w=><option key={w.id} value={w.id}>{w.displayName} · {w.name}</option>)}</select></label>}</div>
      {role==='staff'&&<><fieldset><legend>현장 접근권한</legend>{options.sites.length===0&&<p>등록된 현장이 없습니다. 승인 후 현장을 배정할 수 있습니다.</p>}{options.sites.map(s=><label key={s.id}><input type="checkbox" checked={siteIds.includes(s.id)} onChange={e=>setSiteIds(ids=>e.target.checked?[...ids,s.id]:ids.filter(id=>id!==s.id))}/>{s.name}</label>)}</fieldset><fieldset><legend>추가 권한</legend>{permissionLabels.map(([key,label])=><label key={key}><input type="checkbox" checked={permissions.includes(key)} onChange={e=>setPermissions(p=>e.target.checked?[...p,key]:p.filter(v=>v!==key))}/>{label}</label>)}</fieldset></>}
      {role==='admin'&&<p>관리자는 선택한 회사의 전체 업무와 사용자 승인 권한을 가집니다.</p>}
      {role==='worker'&&<p>연결한 작업진행자의 배정 현장·작업에만 접근합니다.</p>}
      {role==='customer'&&<p>고객 계정으로 승인합니다. 고객 전용 화면은 준비 중이며 사내 업무 자료에 접근할 수 없습니다.</p>}
      {error&&<p role="alert">{error}</p>}<div className="approval-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>취소</button><button className="primary" disabled={busy}>{busy?'처리 중…':'승인 완료'}</button></div>
    </form>}
  </dialog>;
}
export function PendingApprovalCard({onOpen}:{onOpen:()=>void}){
  const {user,authMode}=useAuth();const [count,setCount]=useState(0),[error,setError]=useState('');
  useEffect(()=>{if(authMode!=='supabase'||user?.role!=='admin')return;let alive=true;
    const load=()=>authApi<{count:number}>('/users/pending-count').then(v=>{if(alive){setCount(v.count);setError('')}}).catch(()=>{if(alive)setError('가입 승인 요청을 확인하지 못했습니다. 사용자 관리에서 다시 확인하세요.')});
    void load();const timer=setInterval(load,30000);window.addEventListener('focus',load);window.addEventListener('memberships-updated',load);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',load);window.removeEventListener('memberships-updated',load)};
  },[authMode,user?.id,user?.role]);
  if(authMode!=='supabase'||user?.role!=='admin'||(!count&&!error))return null;
  return <button className="pending-approval-card" onClick={()=>{sessionStorage.setItem('focus-approval-requests','true');onOpen();}}>{error||`가입 승인대기 ${count}명`}<span>가입 승인 요청 확인 →</span></button>;
}

"use client";
import {TenantAdminTools} from "./tenant-admin";
import { useEffect, useState } from "react";
import {ApprovalRequests} from "./approval-requests";
import {permissionLabels} from "./user-permissions";
import { Company } from "@jongro/shared";
import {
  authApi,
  CurrentUser,
  ROLE_LABELS,
  useAuth,
  UserRole,
} from "./auth-provider";
type Form = Omit<CurrentUser, "id"> & { id?: string; password: string };
export interface UserOptions {
  authMode?: string;
  companies: Company[];
  sites: { id: string; name: string }[];
  workers: { id: string; name: string; displayName: string }[];
}
export default function UsersPanel() {
  const { company, refresh } = useAuth();
  const [rows, setRows] = useState<CurrentUser[]>([]),
    [options, setOptions] = useState<UserOptions | null>(null),
    [form, setForm] = useState<Form | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [tab,setTab]=useState('active');
  const blank = (): Form => ({
    companyId: company.id,
    loginId: "",
    email: "",
    name: "",
    displayName: "",
    role: "staff",
    active: true,
    workerId: null,
    siteIds: [],
    permissions: ["writeQuotes"],
    password: "",
  });
  async function load() {
    try {
      const [users, opts] = await Promise.all([
        authApi<CurrentUser[]>("/users"),
        authApi<UserOptions>("/users/options"),
      ]);
      setRows(users);
      setOptions(opts);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    if(sessionStorage.getItem('focus-approval-requests')==='true')setTab('pending');
    const timer=setInterval(load,30000);window.addEventListener("focus",load);
    return()=>{clearInterval(timer);window.removeEventListener("focus",load)};
  }, []);
  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError("");
    try {
      await authApi("/users" + (form.id ? "/" + form.id : ""), {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      setForm(null);
      setNotice(
        "사용자 정보를 저장했습니다. 다음 요청부터 변경된 권한을 적용합니다.",
      );
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>사용자 관리</h2>
          <p>현재 회사의 계정, 역할과 현장 접근 범위를 관리합니다.</p>
        </div>
        <button
          className="primary"
          disabled={options?.authMode === "supabase"}
          onClick={() => {
            setForm(blank());
            setError("");
          }}
        >
          사용자 등록
        </button>
      </div>
      {options?.authMode === "supabase" && <><nav className="tenant-tabs" aria-label="사용자 상태">{[['active','사용중'],['pending','승인대기'],['rejected','거절'],['invites','초대링크']].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>{tab==='pending'&&<ApprovalRequests rows={rows} options={options} onChanged={load}/>}<div hidden={tab!=='invites'}><TenantAdminTools/></div></>}
      {options?.authMode === "supabase" && <p>현재 업체의 가입 신청만 표시합니다. 초대된 사용자의 역할과 승인 상태를 확인하세요. 로그인 제공자가 추가되어도 동일한 Supabase 사용자 UUID의 승인을 유지합니다. 비밀번호는 이 화면에서 설정하지 않습니다.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {form && (
        <form className="site-form" onSubmit={save}>
          <h3>{form.id ? "사용자 수정" : "새 사용자"}</h3>
          <div className="form-grid">
            {(["loginId", "email", "name", "displayName"] as const).map(
              (k, i) => (
                <label key={k}>
                  {["아이디", "이메일", "실제 이름", "표시 이름"][i]}
                  <input
                    required
                    readOnly={options?.authMode === "supabase" && ["loginId","email"].includes(k)}
                    value={form[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </label>
              ),
            )}
            <label>
              비밀번호 {form.id ? "(비워두면 유지)" : ""}
              <input
                type="password"
                disabled={options?.authMode === "supabase"}
                autoComplete="new-password"
                minLength={8}
                required={!form.id}
                value={form.password}
                onChange={(e) => change("password", e.target.value)}
              />
            </label>
            <label>
              역할
              <select
                required
                value={form.role}
                onChange={(e) =>
                  setForm({
                    ...form,
                    role: e.target.value as UserRole,
                    permissions:
                      e.target.value === "staff" ? ["writeQuotes"] : [],
                    workerId:
                      e.target.value === "worker" ? form.workerId : null,
                  })
                }
              >
                <option value="">역할 선택</option>
                {Object.entries(ROLE_LABELS).map(([r, label]) => (
                  <option key={r} value={r}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>가입 상태<select aria-label="가입 상태" value={form.approvalStatus??"승인"} onChange={e=>setForm({...form,approvalStatus:e.target.value as CurrentUser["approvalStatus"],active:e.target.value==="승인"})}>{["승인대기","승인","거절","비활성"].map(v=><option key={v}>{v}</option>)}</select></label>
            <label>휴대전화<input value={form.phone??""} onChange={e=>change("phone",e.target.value)}/></label>
            <label><input type="checkbox" checked={form.locked??false} onChange={e=>change("locked",e.target.checked)}/>계정 잠금</label>
            <label><input type="checkbox" checked={form.passwordResetRequired??false} onChange={e=>change("passwordResetRequired",e.target.checked)}/>비밀번호 초기화 필요</label>
            {form.requestedCompany&&<p>신청 회사: {form.requestedCompany}</p>}
            <label>
              회사 배정
              <select
                required
                value={form.companyId}
                onChange={(e) => change("companyId", e.target.value)}
              >
                <option value="">소속 회사 선택</option>
                {options?.companies.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              작업진행자 연결
              <select
                disabled={form.role !== "worker"}
                value={form.workerId ?? ""}
                onChange={(e) => {
                  const w = options?.workers.find(
                    (w) => w.id === e.target.value,
                  );
                  setForm({
                    ...form,
                    workerId: w?.id ?? null,
                    name: w?.name ?? form.name,
                    displayName: w?.displayName ?? form.displayName,
                  });
                }}
              >
                <option value="">선택</option>
                {options?.workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.displayName} · 실제 이름 {w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => change("active", e.target.checked)}
            />{" "}
            활성 사용자
          </label>
          {form.role === "staff" && (
            <>
              <fieldset>
                <legend>허용된 현장</legend>
                {options?.sites.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={form.siteIds.includes(s.id)}
                      onChange={(e) =>
                        change(
                          "siteIds",
                          e.target.checked
                            ? [...form.siteIds, s.id]
                            : form.siteIds.filter((id) => id !== s.id),
                        )
                      }
                    />
                    {s.name}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>추가 권한</legend>
                {permissionLabels.map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={form.permissions.includes(key)}
                      onChange={(e) =>
                        change(
                          "permissions",
                          e.target.checked
                            ? [...form.permissions, key]
                            : form.permissions.filter((p) => p !== key),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          <div className="form-actions">
            <button type="button" onClick={() => setForm(null)}>
              취소
            </button>
            <button className="primary" disabled={busy}>
              저장
            </button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>표시 이름</th>
              <th>실제 이름</th>
              <th>아이디 / 이메일</th>
              <th>역할</th>
              <th>상태</th>
              <th>작업진행자</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter(u=>options?.authMode!=='supabase'||(tab==='active'?u.approvalStatus!=='승인대기'&&u.approvalStatus!=='거절':tab==='rejected'?u.approvalStatus==='거절':false)).map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td>{u.name}</td>
                <td>
                  {u.loginId}
                  <small>{u.email}</small>
                </td>
                <td>{u.companyId && u.roleAssigned!==false ? ROLE_LABELS[u.role] : "미지정"}{u.requestedCompany && <small>신청 회사: {u.requestedCompany}</small>}</td>
                <td>{u.approvalStatus??(u.active?"승인":"비활성")} · {u.locked?"잠금":u.active?"활성":"비활성"}{u.passwordResetRequired&&" · 비밀번호 초기화 필요"}</td>
                <td>
                  {options?.workers.find((w) => w.id === u.workerId)
                    ?.displayName ?? "—"}
                </td>
                <td>
                  <button
                    onClick={() => {
                      setForm({ ...u, role: (u.companyId && u.roleAssigned!==false ? u.role : "") as UserRole, password: "" });
                      setNotice("");
                    }}
                  >
                    수정
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        고객 역할은 구조만 준비되어 있으며 현재 로그인할 수 없습니다. 회사
        배정은 관리 권한이 있는 회사만 선택할 수 있습니다.
      </p>
    </section>
  );
}
export { default as CompanySettings } from "./quote-company-settings";

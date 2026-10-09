"use client";
import { useEffect, useState } from "react";
import { Company } from "@jongno/shared";
import {
  authApi,
  CurrentUser,
  ROLE_LABELS,
  useAuth,
  UserRole,
} from "./auth-provider";
type Form = Omit<CurrentUser, "id"> & { id?: string; password: string };
interface Options {
  companies: Company[];
  sites: { id: string; name: string }[];
  workers: { id: string; name: string; displayName: string }[];
}
const permissionLabels = [
  ["internalCosts", "내부 원가 조회"],
  ["siteFinance", "현장손익·계약금액 조회"],
  ["workerPayments", "작업진행자 지급액 조회"],
  ["editSchedule", "일정 수정"],
  ["writeQuotes", "견적 작성"],
] as const;
export default function UsersPanel() {
  const { company, refresh } = useAuth();
  const [rows, setRows] = useState<CurrentUser[]>([]),
    [options, setOptions] = useState<Options | null>(null),
    [form, setForm] = useState<Form | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
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
        authApi<Options>("/users/options"),
      ]);
      setRows(users);
      setOptions(opts);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
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
          onClick={() => {
            setForm(blank());
            setError("");
          }}
        >
          사용자 등록
        </button>
      </div>
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
                {Object.entries(ROLE_LABELS).map(([r, label]) => (
                  <option key={r} value={r}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              회사 배정
              <select
                value={form.companyId}
                onChange={(e) => change("companyId", e.target.value)}
              >
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
            {rows.map((u) => (
              <tr key={u.id}>
                <td>{u.displayName}</td>
                <td>{u.name}</td>
                <td>
                  {u.loginId}
                  <small>{u.email}</small>
                </td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td>{u.active ? "활성" : "비활성"}</td>
                <td>
                  {options?.workers.find((w) => w.id === u.workerId)
                    ?.displayName ?? "—"}
                </td>
                <td>
                  <button
                    onClick={() => {
                      setForm({ ...u, password: "" });
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
export function CompanySettings() {
  const { company, refresh } = useAuth();
  const [form, setForm] = useState(company),
    [notice, setNotice] = useState("");
  return (
    <section className="panel">
      <h2>회사 설정</h2>
      <form
        className="site-form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await authApi("/company/settings", {
              method: "PUT",
              body: JSON.stringify(form),
            });
            await refresh();
            setNotice("회사 설정을 저장했습니다.");
          } catch (e) {
            setNotice((e as Error).message);
          }
        }}
      >
        <div className="form-grid">
          {(["name", "displayName", "phone", "email", "address"] as const).map(
            (k, i) => (
              <label key={k}>
                {["회사명", "화면 회사명", "대표전화", "이메일", "주소"][i]}
                <input
                  required={i < 2}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                />
              </label>
            ),
          )}
          <label>
            회사 로고 HTTPS 주소
            <input
              type="url"
              value={form.logoUrl ?? ""}
              onChange={(e) =>
                setForm({ ...form, logoUrl: e.target.value || null })
              }
            />
          </label>
        </div>
        <button className="primary">회사 설정 저장</button>
        <p role="status">{notice}</p>
      </form>
    </section>
  );
}

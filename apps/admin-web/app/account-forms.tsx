"use client";
import FieldHelper from "./field-helper";
import { useState } from "react";
import { authApi, useAuth } from "./auth-provider";
export function SignupForm({
  onBack,
}: {
  onBack: () => void;
}) {
  const [form, setForm] = useState({
      name: "",
      email: "",
      phone: "",
      companyName: "",
      password: "",
      role: "staff",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await authApi("/auth/signup", {
            method: "POST",
            body: JSON.stringify(form),
          });
          setNotice(
            "가입 신청이 접수되었습니다. 관리자의 승인 후 로그인할 수 있습니다.",
          );
          setForm({ ...form, password: "" });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>가입 신청</h2>
      <FieldHelper
        pose="guide"
        title="회사 업무공간 가입을 안내합니다."
        description="관리자가 소속과 역할을 확인한 후 업무를 시작할 수 있습니다."
      />
      {(["name", "email", "phone", "companyName", "password"] as const).map(
        (k, i) => (
          <label key={k}>
            {["이름", "이메일", "휴대전화", "회사명", "비밀번호"][i]}
            <input
              required
              autoComplete={k === "password" ? "new-password" : undefined}
              type={
                k === "password" ? "password" : k === "email" ? "email" : "text"
              }
              minLength={k === "password" ? 8 : undefined}
              placeholder={k === "companyName" ? "소속 회사명을 직접 입력하세요" : ["이름", "이메일", "휴대전화", "회사명", "8자 이상 비밀번호"][i]}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </label>
        ),
      )}
      <label>
        가입유형 (희망 · 실제 역할은 관리자가 지정)
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="staff">사내직원</option>
          <option value="worker">작업진행자</option>
          <option value="customer">향후 고객</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className="primary" disabled={busy}>
        가입 신청 제출
      </button>
      <button type="button" onClick={onBack}>
        로그인으로 돌아가기
      </button>
      <p>
        이 업무공간의 관리자가 회사 소속과 역할을 검토합니다. 고객 업무는 준비
        중입니다.
      </p>
    </form>
  );
}
export default function PersonalProfile() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({
      name: user?.name ?? "",
      displayName: user?.displayName ?? "",
      email: user?.email ?? "",
      phone: user?.phone ?? "",
      password: "",
      currentPassword: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await authApi("/auth/profile", {
            method: "PUT",
            body: JSON.stringify(form),
          });
          setNotice(
            form.password
              ? "비밀번호가 변경되었습니다. 다시 로그인해 주세요."
              : "내 정보를 저장했습니다.",
          );
          setForm({ ...form, password: "", currentPassword: "" });
          await refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>내 정보</h2>
      <p>회사·역할·업무 접근범위는 관리자가 설정합니다.</p>
      {(
        [
          "name",
          "displayName",
          "phone",
          "email",
          "currentPassword",
          "password",
        ] as const
      ).map((k, i) => (
        <label key={k}>
          {
            [
              "이름",
              "표시 이름",
              "휴대전화",
              "이메일",
              "현재 비밀번호 (변경 시)",
              "새 비밀번호 (선택)",
            ][i]
          }
          <input
            type={
              k.includes("assword")
                ? "password"
                : k === "email"
                  ? "email"
                  : "text"
            }
            autoComplete={k === "password" ? "new-password" : undefined}
            required={k === "name" || k === "displayName" || k === "email"}
            value={form[k]}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          />
        </label>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className="primary" disabled={busy}>
        내 정보 저장
      </button>
    </form>
  );
}

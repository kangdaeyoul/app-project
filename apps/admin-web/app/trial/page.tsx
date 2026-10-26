"use client";
import { useState } from "react";
import DemoWelcome from "../demo-welcome";
import { authApi, AuthProvider } from "../auth-provider";
function TrialEntry() {
  const [role, setRole] = useState("admin"),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login-page login-page-compact">
      <section className="login-card login-card-compact">
        <h1>체험 공간</h1>
        <p>실제 회사 자료와 분리된 예시 공간입니다.</p>
        <button className="primary" onClick={() => setOpen(true)}>
          체험 시작
        </button>
        <p>
          <a href="/">공통 홈</a>
        </p>
        {error && <p role="alert">{error}</p>}
        {open && (
          <DemoWelcome
            account={role}
            busy={busy}
            publicTrial
            onAccountChange={setRole}
            onCancel={() => setOpen(false)}
            onStart={async (tutorial) => {
              setBusy(true);
              setError("");
              try {
                await authApi("/trial/start", {
                  method: "POST",
                  body: JSON.stringify({
                    role: role === "worker1" ? "worker" : role,
                  }),
                });
                sessionStorage.setItem(
                  "demo-entry",
                  tutorial ? "tutorial" : "home",
                );
                window.location.assign("/");
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
                setOpen(false);
              }
            }}
          />
        )}
      </section>
    </main>
  );
}
export default function TrialPage() {
  return (
    <AuthProvider>
      <TrialEntry />
    </AuthProvider>
  );
}

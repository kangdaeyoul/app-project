"use client";
import { useEffect, useRef, useState } from "react";
import { Company, QuoteCompanySnapshot } from "@jongro/shared";
import { authApi, useAuth } from "./auth-provider";
import QuoteCompanyEditor from "./quote-company-editor";

export default function QuoteCompanyDialog({ value, onApply, onClose }: {
  value: QuoteCompanySnapshot;
  onApply: (profile: QuoteCompanySnapshot) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { user, refresh } = useAuth();
  const [draft, setDraft] = useState(() => structuredClone(value));
  const [saving, setBusy] = useState(false), [uploading, setUploading] = useState(false), [message, setMessage] = useState("");
  const busy = saving || uploading;
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  async function saveDefault() {
    if (!confirm("새 견적에 사용할 회사 기본정보를 저장합니다. 이미 저장한 견적은 변경하지 않습니다. 계속할까요?")) return;
    setBusy(true);
    setMessage("");
    try {
      // Fetch current settings so unrelated company preferences are preserved.
      const { company } = await authApi<{ company: Company }>("/company/current");
      await authApi("/company/settings", { method: "PUT", body: JSON.stringify({
        ...company, name: draft.name, phone: draft.phone, email: draft.email,
        address: draft.address, quoteProfile: draft,
      }) });
      await refresh();
      setMessage("회사 기본정보를 저장했습니다. 새 견적부터 사용합니다. 이번 견적에도 사용하려면 아래 적용 버튼을 누르세요.");
    } catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="quote-company-dialog" aria-labelledby="quote-company-title"
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="quote-company-dialog-heading">
      <h2 id="quote-company-title">회사정보 / 회사 프로필 변경</h2>
      <button type="button" disabled={busy} onClick={onClose}>닫기</button>
    </div>
    <p>회사명·대표자·사업자등록번호·연락처·담당자·로고·직인을 이 견적에 맞게 수정하세요. 기존 견적서 양식은 유지됩니다.</p>
    <p>‘이번 견적에만 적용’은 작성 중인 견적만 바꿉니다. ‘회사 기본정보 저장’은 새로 만드는 견적의 기본값을 바꿉니다.</p>
    <QuoteCompanyEditor value={draft} onChange={setDraft} onBusyChange={setUploading} disabled={saving}/>
    <p role="status">{message}</p>
    <div className="quote-company-dialog-actions">
      {user?.role === "admin" && <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void saveDefault()}>회사 기본정보 저장</button>}
      <button type="button" className="primary-button" disabled={busy || !draft.name.trim()} onClick={() => { onApply(draft); onClose(); }}>이번 견적에만 적용</button>
    </div>
  </dialog>;
}

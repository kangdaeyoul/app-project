"use client";
import { useEffect, useState } from "react";
type Message = {
  id: string;
  siteId: string;
  asId: string;
  siteName: string;
  address: string;
  phone: string;
  asNumber?: string;
  title: string;
  content: string;
  senderName: string;
  sentAt: string;
  important: boolean;
  unread: boolean;
  canSend: boolean;
  hasAttachments: boolean;
  recipients: {
    workerId: string;
    displayName: string;
    readAt: string | null;
  }[];
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch("/api/work-instructions" + path, init);
  const b = await r.json();
  if (!r.ok) throw Error(b.message || "작업지시 요청 실패");
  return b;
}
export default function InstructionsPanel({
  siteId,
  asId,
  onOpen,
  onChanged,
}: {
  siteId?: string;
  asId?: string;
  onOpen?: (siteId: string, asId: string) => void;
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<Message[]>([]),
    [workers, setWorkers] = useState<{ id: string; name: string }[]>([]),
    [canSend, setCanSend] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<Message | null>(null),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [mode, setMode] = useState(asId ? "as" : "all"),
    [workerId, setWorkerId] = useState(""),
    [important, setImportant] = useState(false),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<Message[]>(
      `?${new URLSearchParams({ ...(siteId ? { siteId } : {}), ...(asId ? { asId } : {}) })}`,
    )
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    setSelected(null);
    load();
    if (siteId)
      api<{ id: string; name: string }[]>(
        `/options?${new URLSearchParams({ siteId, ...(asId ? { asId } : {}) })}`,
      )
        .then((w) => {
          setWorkers(w);
          setCanSend(true);
        })
        .catch(() => setCanSend(false));
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [siteId, asId]);
  async function open(row: Message) {
    setError("");
    try {
      const r = row.canSend
        ? row
        : await api<Message>(`/${row.id}/read`, { method: "POST" });
      setSelected(r);
      await load();
      onChanged?.();
      window.dispatchEvent(new Event("instructions-changed"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{ duplicate: boolean; sentCount: number }>("", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          asId: asId ?? "",
          title,
          content,
          mode,
          workerId,
          important,
        }),
      });
      setNotice(
        r.duplicate
          ? "동일한 작업지시가 이미 발송되어 중복 발송하지 않았습니다."
          : `${r.sentCount}명에게 발송했습니다.`,
      );
      await load();
      onChanged?.();
      window.dispatchEvent(new Event("instructions-changed"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel instructions-panel">
      <div className="panel-title">
        <div>
          <h2>{siteId ? "작업지시 / 공지" : "알림센터 · 작업지시"}</h2>
          <p>
            중요한 미확인 지시를 먼저 확인하세요.{" "}
            {rows.filter((r) => r.important && r.unread).length}건
          </p>
        </div>
        <button onClick={load}>새로고침</button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {canSend && siteId && (
        <form onSubmit={send} className="instruction-form">
          <div className="form-grid">
            <label>
              발송 대상
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="single">특정 작업진행자 1명</option>
                <option value="all">전체 참여 작업진행자</option>
                {asId && <option value="as">A/S 대표 담당자</option>}
              </select>
            </label>
            {mode === "single" && (
              <label>
                수신 작업진행자
                <select
                  required
                  value={workerId}
                  onChange={(e) => setWorkerId(e.target.value)}
                >
                  <option value="">선택하세요</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              제목
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="full-width">
              작업지시 내용
              <textarea
                required
                maxLength={5000}
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={important}
              onChange={(e) => setImportant(e.target.checked)}
            />{" "}
            중요 작업지시
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? "발송 중…" : "작업지시 발송"}
          </button>
        </form>
      )}
      <div className="instruction-list">
        {[...rows]
          .sort(
            (a, b) =>
              Number(b.important && b.unread) - Number(a.important && a.unread),
          )
          .map((r) => (
            <button
              key={r.id}
              className={`instruction-card ${r.important && r.unread ? "instruction-important" : ""}`}
              onClick={() => open(r)}
            >
              <span>
                {r.important ? "중요 · " : ""}
                {r.unread ? "안읽음" : "읽음"} · {r.siteName}
                {r.asId ? " · A/S" : ""}
              </span>
              <strong>{r.title}</strong>
              <span>
                {r.senderName} · {new Date(r.sentAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}
              </span>
              {r.canSend && (
                <small>
                  읽음 {r.recipients.filter((p) => p.readAt).length}/
                  {r.recipients.length}명
                </small>
              )}
            </button>
          ))}
        {!rows.length && <p className="empty">등록된 작업지시가 없습니다.</p>}
      </div>
      {selected && (
        <section className="instruction-detail">
          <div className="panel-title">
            <h3>{selected.title}</h3>
            <button onClick={() => setSelected(null)}>닫기</button>
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{selected.content}</p>
          <p>
            {selected.senderName} ·{" "}
            {new Date(selected.sentAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} · 첨부파일{" "}
            {selected.hasAttachments ? "있음" : "없음"}
          </p>
          <h4>
            {selected.siteName}
            {selected.asNumber && ` · ${selected.asNumber}`}
          </h4>
          <p>
            {selected.address} ·{" "}
            <a href={`tel:${selected.phone}`}>
              {selected.phone || "연락처 없음"}
            </a>
          </p>
          {onOpen && (
            <button
              className="primary-button"
              onClick={() => onOpen(selected.siteId, selected.asId)}
            >
              {selected.asId ? "A/S 상세로 이동" : "현장 상세로 이동"}
            </button>
          )}
          <ul>
            {selected.recipients.map((r) => (
              <li key={r.workerId}>
                {r.displayName} ·{" "}
                {r.readAt
                  ? `읽음 ${new Date(r.readAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}`
                  : "안읽음"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

export function InstructionSiteView({ siteId }: { siteId: string }) {
  const [site, setSite] = useState<{
      name: string;
      address: string;
      phone: string;
      contactName: string;
      description: string;
      works: { id: string; date: string; content: string; status: string }[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<typeof site>(`/site/${siteId}`)
      .then(setSite)
      .catch((e) => setError(e.message));
  }, [siteId]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {site && (
        <section className="panel instruction-site-summary">
          <h2>{site.name}</h2>
          <p>{site.address}</p>
          <p>
            {site.contactName} · <a href={`tel:${site.phone}`}>{site.phone}</a>
          </p>
          <p>{site.description}</p>
          <h3>본인 작업일정</h3>
          {site.works.map((w) => (
            <p key={w.id}>
              {w.date} · {w.status} · {w.content}
            </p>
          ))}
        </section>
      )}
      <InstructionsPanel siteId={siteId} />
    </>
  );
}

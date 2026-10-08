"use client";
import { useEffect, useState } from "react";
import {
  AfterServiceInput,
  AfterServiceView,
  AS_TYPES,
  AS_PHOTO_PHASES,
  DailyWork,
  MaterialUsageInput,
} from "@jongno/shared";
import MaterialRows from "./material-rows";
import ExpensesPanel from "./expenses-panel";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const empty = (siteId = ""): AfterServiceInput => ({
  siteId,
  receivedDate: today(),
  receivedBy: "관리자",
  request: "",
  location: "",
  equipment: "",
  type: "하자보수",
  urgent: false,
  priority: "일반",
  billing: "무상",
  plannedDate: "",
  plannedStart: "09:00",
  plannedEnd: "17:00",
  managerId: "",
  participantIds: [],
  status: "접수",
  notes: "",
  previousId: "",
  quoteIds: [],
  originalWorkIds: [],
  inspectionIds: [],
  originalPhotoIds: [],
  materialUsageIds: [],
  completionFileKeys: [],
  workIds: [],
  cause: "",
  action: "",
  testResult: "",
  completedDate: "",
  result: "",
  finalAction: "",
  normalOperation: false,
  needsVisit: false,
  needsQuote: false,
  resultConfirmed: false,
  chargeAmount: 0,
});
type Options = {
  states: { key: string; label: string }[];
  types: string[];
  canCreate: boolean;
  canAssign: boolean;
  canFinance: boolean;
  sites: { id: string; name: string; client: string }[];
  workers: { id: string; displayName: string }[];
  works: {
    id: string;
    siteId: string;
    workDate: string;
    content: string;
    materials: MaterialUsageInput[];
  }[];
  quotes: { id: string; siteId: string; name: string }[];
  previous: {
    id: string;
    siteId: string;
    number: string;
    location: string;
    equipment: string;
  }[];
  inspections: {
    id: string;
    siteId: string;
    items: { id: string; inspectionNumber?: string; issue?: string }[];
  }[];
};
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/after-service${path}`, init);
  const b = await r.json();
  if (!r.ok)
    throw Object.assign(
      Error(typeof b.message === "string" ? b.message : "요청 실패"),
      { warnings: b.warnings ?? [] },
    );
  return b;
}
export default function AfterServicePanel({
  siteId,
  initialAsId,
  onChanged,
  onOpenQuote,
}: {
  siteId?: string;
  initialAsId?: string;
  onChanged?: () => void;
  onOpenQuote?: (id: string) => void;
}) {
  const [rows, setRows] = useState<AfterServiceView[]>([]),
    [options, setOptions] = useState<Options | null>(null),
    [detail, setDetail] = useState<AfterServiceView | null>(null),
    [form, setForm] = useState<AfterServiceInput | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [saving, setSaving] = useState(false),
    [warnings, setWarnings] = useState<string[]>([]),
    [force, setForce] = useState(false),
    [tab, setTab] = useState("처리기록");
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [billing, setBilling] = useState(""),
    [type, setType] = useState(""),
    [worker, setWorker] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [contact, setContact] = useState("");
  const [workForm, setWorkForm] = useState<DailyWork | null>(null),
    [cause, setCause] = useState(""),
    [action, setAction] = useState(""),
    [testResult, setTestResult] = useState("");
  const [photoPhase, setPhotoPhase] = useState("접수 사진"),
    [photoLocation, setPhotoLocation] = useState(""),
    [photoDescription, setPhotoDescription] = useState(""),
    [capturedAt, setCapturedAt] = useState(""),
    [fileList, setFileList] = useState<File[]>([]),
    [previewPhoto, setPreviewPhoto] = useState(""),
    [sourcePhotos, setSourcePhotos] = useState<
      { id: string; description: string }[]
    >([]),
    [mode, setMode] = useState("처리결과 + 전후사진"),
    [pdfUrl, setPdfUrl] = useState(""),
    [statesForm, setStatesForm] = useState<Options["states"] | null>(null);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      api<AfterServiceView[]>(siteId ? `?siteId=${siteId}` : "", {
        signal: c.signal,
      }),
      api<Options>("/options", { signal: c.signal }),
    ])
      .then(([r, o]) => {
        setRows(r);
        setOptions(o);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, revision]);
  useEffect(() => {
    if (!form?.siteId) {
      setSourcePhotos([]);
      return;
    }
    const c = new AbortController();
    fetch(`/api/photos?siteId=${form.siteId}`, { signal: c.signal })
      .then((r) => r.json())
      .then((r) => setSourcePhotos(Array.isArray(r) ? r : []))
      .catch(() => {});
    return () => c.abort();
  }, [form?.siteId]);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  useEffect(() => {
    if (initialAsId) void open(initialAsId);
  }, [initialAsId]);
  async function open(id: string) {
    try {
      const d = await api<AfterServiceView>(`/${id}`);
      setDetail(d);
      setWorkForm(d.works.at(-1) ?? null);
      setCause(d.cause);
      setAction(d.action);
      setTestResult(d.testResult);
      setPhotoLocation(d.location);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function perform(path: string, body?: unknown, method = "POST") {
    setSaving(true);
    setError("");
    try {
      await api(path, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setRevision((v) => v + 1);
      onChanged?.();
      if (detail) await open(detail.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function edit(d?: AfterServiceView) {
    setEditing(d?.id ?? null);
    setForm(d ? { ...d, chargeAmount: d.chargeAmount ?? 0 } : empty(siteId));
    setForce(false);
    setWarnings([]);
    setError("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const d = await api<AfterServiceView>(editing ? `/${editing}` : "", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, force }),
      });
      setForm(null);
      setRevision((v) => v + 1);
      onChanged?.();
      await open(d.id);
    } catch (e) {
      setError((e as Error).message);
      setWarnings((e as Error & { warnings?: string[] }).warnings ?? []);
    } finally {
      setSaving(false);
    }
  }
  const change = (patch: Partial<AfterServiceInput>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setForce(false);
  };
  function text(
    key: keyof AfterServiceInput,
    label: string,
    kind = "text",
    required = false,
  ) {
    return (
      <label key={key}>
        {label}
        <input
          aria-label={label}
          required={required}
          type={kind}
          value={String(form?.[key] ?? "")}
          onChange={(e) =>
            change({
              [key]:
                kind === "number" ? Number(e.target.value) : e.target.value,
            })
          }
        />
      </label>
    );
  }
  function select(
    key:
      | "siteId"
      | "managerId"
      | "status"
      | "type"
      | "priority"
      | "billing"
      | "previousId",
    label: string,
    items: { id: string; name: string }[],
    emptyOption = false,
  ) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={String(form?.[key] ?? "")}
          disabled={
            (key === "siteId" && !!editing) ||
            (key === "managerId" && !options?.canAssign)
          }
          onChange={(e) =>
            change({
              [key]: e.target.value,
              ...(key === "billing" && e.target.value !== "유상"
                ? { chargeAmount: 0 }
                : {}),
            })
          }
        >
          {emptyOption && <option value="">선택 안 함</option>}
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function multi(
    key:
      | "participantIds"
      | "quoteIds"
      | "originalWorkIds"
      | "inspectionIds"
      | "originalPhotoIds"
      | "materialUsageIds"
      | "workIds",
    label: string,
    items: { id: string; name: string }[],
  ) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          multiple
          value={form?.[key] ?? []}
          onChange={(e) =>
            change({
              [key]: Array.from(e.target.selectedOptions, (o) => o.value),
            })
          }
        >
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  async function upload(path: string, photo = false) {
    if (!detail) return;
    setSaving(true);
    setError("");
    try {
      const data = new FormData();
      fileList.forEach((f) => data.append("files", f));
      if (photo) {
        data.append("location", photoLocation);
        data.append("description", photoDescription);
        if (capturedAt)
          data.append("capturedAt", new Date(capturedAt).toISOString());
      }
      await api(`/${detail.id}/${path}`, { method: "POST", body: data });
      setFileList([]);
      await open(detail.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function report(download: boolean) {
    if (!detail) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/after-service/${detail.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, date: today(), save: download }),
      });
      if (!r.ok) throw Error((await r.json()).message);
      const url = URL.createObjectURL(await r.blob());
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${detail.siteName}_AS처리결과_${today()}.pdf`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } else setPdfUrl(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const filtered = rows.filter(
    (r) =>
      (!search ||
        [r.number, r.siteName, r.customerName, r.request]
          .join(" ")
          .includes(search)) &&
      (!contact || [r.receivedBy, r.contactName].join(" ").includes(contact)) &&
      (!status || r.status === status) &&
      (!billing || r.billing === billing) &&
      (!type || r.type === type) &&
      (!worker ||
        r.managerId === worker ||
        r.participantIds.includes(worker)) &&
      (!from || r.receivedDate >= from) &&
      (!to || r.receivedDate <= to),
  );
  return (
    <div className="as-management">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {form ? (
        <section className="panel as-editor">
          <div className="panel-title">
            <h2>{editing ? "A/S 수정" : "A/S 접수"}</h2>
            <button onClick={() => setForm(null)}>취소</button>
          </div>
          <form onSubmit={save}>
            <div className="form-grid">
              {select(
                "siteId",
                "연결 현장",
                options?.sites.map((s) => ({ id: s.id, name: s.name })) ?? [],
                true,
              )}
              {text("receivedDate", "접수일", "date", true)}
              {text("receivedBy", "접수자", "text", true)}
              {text("request", "고객 요청내용", "text", true)}
              {text("location", "발생 위치")}
              {text("equipment", "관련 설비")}
              {select(
                "type",
                "A/S 유형",
                AS_TYPES.map((s) => ({ id: s, name: s })),
              )}
              {select(
                "priority",
                "우선순위",
                ["일반", "높음", "긴급"].map((s) => ({ id: s, name: s })),
              )}
              {select(
                "billing",
                "유상/무상",
                ["무상", "유상", "판단보류"].map((s) => ({ id: s, name: s })),
              )}
              {select(
                "status",
                "처리상태",
                options?.states.map((s) => ({ id: s.key, name: s.label })) ??
                  [],
              )}
              {text("plannedDate", "예정일", "date")}
              {text("plannedStart", "예정 시작시간", "time")}
              {text("plannedEnd", "예정 종료시간", "time")}
              {select(
                "managerId",
                "대표 작업진행자",
                options?.workers.map((w) => ({
                  id: w.id,
                  name: w.displayName,
                })) ?? [],
                true,
              )}
              {multi(
                "participantIds",
                "참여 작업진행자",
                options?.workers
                  .filter((w) => w.id !== form.managerId)
                  .map((w) => ({ id: w.id, name: w.displayName })) ?? [],
              )}
              <label>
                <input
                  type="checkbox"
                  checked={form.urgent}
                  onChange={(e) =>
                    change({
                      urgent: e.target.checked,
                      priority: e.target.checked ? "긴급" : form.priority,
                    })
                  }
                />
                긴급 A/S
              </label>
              {select(
                "previousId",
                "이전 A/S",
                options?.previous
                  .filter((r) => r.siteId === form.siteId && r.id !== editing)
                  .map((r) => ({
                    id: r.id,
                    name: `${r.number} · ${r.location} ${r.equipment}`,
                  })) ?? [],
                true,
              )}
              {multi(
                "originalWorkIds",
                "연결 기존 일일작업",
                options?.works
                  .filter((w) => w.siteId === form.siteId)
                  .map((w) => ({
                    id: w.id,
                    name: `${w.workDate} ${w.content}`,
                  })) ?? [],
              )}
              {multi(
                "workIds",
                "연결 A/S 처리작업",
                options?.works
                  .filter((w) => w.siteId === form.siteId)
                  .map((w) => ({
                    id: w.id,
                    name: `${w.workDate} ${w.content}`,
                  })) ?? [],
              )}
              {multi(
                "quoteIds",
                "연결 기존 견적",
                options?.quotes
                  .filter((q) => q.siteId === form.siteId)
                  .map((q) => ({
                    id: q.id,
                    name: q.name + " " + q.id.slice(0, 8),
                  })) ?? [],
              )}
              {multi(
                "inspectionIds",
                "연결 점검지적사항",
                options?.inspections
                  .filter((r) => r.siteId === form.siteId)
                  .flatMap((r) => [
                    { id: r.id, name: `보고서 ${r.id.slice(0, 8)}` },
                    ...r.items.map((i) => ({
                      id: i.id,
                      name: i.inspectionNumber ?? i.id,
                    })),
                  ]) ?? [],
              )}
              {multi(
                "originalPhotoIds",
                "연결 기존 사진",
                sourcePhotos.map((p) => ({
                  id: p.id,
                  name: p.description || p.id,
                })),
              )}
              {multi(
                "materialUsageIds",
                "연결 기존 사용자재",
                options?.works
                  .filter((w) => w.siteId === form.siteId)
                  .flatMap((w) =>
                    w.materials.map((m) => ({
                      id: m.id ?? "",
                      name: `${m.name} ${m.specification}`,
                    })),
                  ) ?? [],
              )}
              <label>
                연결 완료보고서 저장소 키
                <input
                  value={form.completionFileKeys.join(",")}
                  onChange={(e) =>
                    change({
                      completionFileKeys: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              {text("cause", "원인")}
              {text("action", "조치내용")}
              {text("testResult", "시험 및 확인내용")}
              {text("completedDate", "완료일", "date")}
              {text("result", "처리결과")}
              {text("finalAction", "최종 조치내용")}
              {text("notes", "비고")}
              {options?.canFinance &&
                form.billing === "유상" &&
                text("chargeAmount", "확정 A/S 매출(VAT 포함)", "number")}
              {(
                [
                  "normalOperation",
                  "needsVisit",
                  "needsQuote",
                  "resultConfirmed",
                ] as const
              ).map((k, i) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={form[k]}
                    onChange={(e) => change({ [k]: e.target.checked })}
                  />
                  {
                    [
                      "정상작동 확인",
                      "추가 방문 필요",
                      "추가 견적 필요",
                      "관리자 결과확인 완료",
                    ][i]
                  }
                </label>
              ))}
            </div>
            {warnings.length > 0 && (
              <div className="schedule-warning">
                {warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {options?.canFinance && (
                  <label>
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                    />
                    충돌을 확인하고 관리자 강제 배정
                  </label>
                )}
              </div>
            )}
            <div className="form-actions">
              <button className="primary-button" disabled={saving}>
                A/S 저장
              </button>
            </div>
            <p>
              첨부파일과 사진은 접수 저장 후 추가하세요. 완료 이후 결과확인을
              거쳐 종결합니다.
            </p>
          </form>
        </section>
      ) : detail ? (
        <>
          <section className="panel as-detail">
            <div className="panel-title">
              <div>
                <small>
                  {detail.number} · {detail.billing}
                </small>
                <h2>
                  {detail.siteName}{" "}
                  {detail.urgent && <span className="as-urgent">긴급</span>}
                </h2>
                <p>
                  {detail.location} · {detail.equipment}
                </p>
              </div>
              <button onClick={() => setDetail(null)}>목록</button>
            </div>
            <h3>{detail.request}</h3>
            <p>
              {detail.plannedDate || "예정일 미정"} {detail.plannedStart}–
              {detail.plannedEnd} · {detail.managerName} · {detail.status}
            </p>
            <p>
              {detail.contactName} ·{" "}
              <a href={`tel:${detail.phone}`}>
                {detail.phone || "연락처 없음"}
              </a>
            </p>
            {detail.delayed && (
              <p className="as-urgent">기한이 지난 미처리 A/S입니다.</p>
            )}
            {detail.recurrenceCount > 1 && (
              <p className="schedule-warning">
                동일 위치·설비 접수 {detail.recurrenceCount}건 · 이전 A/S{" "}
                {options?.previous.find((r) => r.id === detail.previousId)
                  ?.number || "연결 없음"}
              </p>
            )}
            <div className="as-actions">
              <button
                disabled={saving || !detail.works.length}
                onClick={() => perform(`/${detail.id}/start`)}
              >
                작업 시작
              </button>
              <button
                onClick={() => {
                  setTab("사진");
                  setPhotoPhase("작업 전");
                }}
              >
                사진 등록
              </button>
              <button
                disabled={saving || !detail.works.length}
                onClick={() => perform(`/${detail.id}/finish`)}
              >
                작업 완료
              </button>
              {detail.canEdit && (
                <button onClick={() => edit(detail)}>접수·완료정보 수정</button>
              )}
              {detail.canFinance && detail.billing === "유상" && (
                <button
                  onClick={async () => {
                    try {
                      const q = await api<{ id: string }>(
                        `/${detail.id}/quote`,
                        { method: "POST" },
                      );
                      onOpenQuote?.(q.id);
                      await open(detail.id);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  A/S 견적 생성
                </button>
              )}
              {detail.canClose && (
                <button
                  onClick={() => {
                    const f = {
                      ...detail,
                      chargeAmount: detail.chargeAmount ?? 0,
                      status: "처리완료",
                      completedDate: detail.completedDate || today(),
                    };
                    setEditing(detail.id);
                    setForm(f);
                  }}
                >
                  처리완료 정보 입력
                </button>
              )}
              {detail.canClose &&
                ["처리완료", "재확인필요"].includes(detail.status) && (
                  <button
                    onClick={() =>
                      perform(
                        `/${detail.id}`,
                        { ...detail, status: "종결", resultConfirmed: true },
                        "PUT",
                      )
                    }
                  >
                    결과확인 후 종결
                  </button>
                )}
              {detail.canClose && (
                <button
                  onClick={() => {
                    if (
                      confirm("A/S를 삭제하시겠습니까? 비용 원장은 유지됩니다.")
                    )
                      void perform(`/${detail.id}`, undefined, "DELETE").then(
                        () => setDetail(null),
                      );
                  }}
                >
                  삭제
                </button>
              )}
            </div>
          </section>
          <div className="tab-list" role="tablist">
            {["처리기록", "사진", "비용", "연결기록", "결과보고서", "첨부파일"]
              .filter((t) => t !== "비용" || detail.canFinance)
              .map((t) => (
                <button
                  role="tab"
                  key={t}
                  aria-selected={tab === t}
                  className={tab === t ? "selected" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
          </div>
          <section className="panel as-content">
            {tab === "처리기록" ? (
              <>
                {detail.works.length > 0 && (
                  <label>
                    처리 작업일
                    <select
                      value={workForm?.id ?? ""}
                      onChange={(e) =>
                        setWorkForm(
                          detail.works.find((w) => w.id === e.target.value) ??
                            null,
                        )
                      }
                    >
                      {detail.works.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.workDate} {w.status}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {workForm ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(
                        `/${detail.id}/work`,
                        {
                          dailyWorkId: workForm.id,
                          startTime: workForm.startTime,
                          endTime: workForm.endTime,
                          content: workForm.content,
                          notes: workForm.notes,
                          status: workForm.status,
                          materials: workForm.materials,
                          cause,
                          action,
                          testResult,
                        },
                        "PUT",
                      );
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        작업일
                        <input type="date" readOnly value={workForm.workDate} />
                      </label>
                      <label>
                        시작시간
                        <input
                          type="time"
                          value={workForm.startTime}
                          onChange={(e) =>
                            setWorkForm({
                              ...workForm,
                              startTime: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        종료시간
                        <input
                          type="time"
                          value={workForm.endTime}
                          onChange={(e) =>
                            setWorkForm({
                              ...workForm,
                              endTime: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        작업내용
                        <textarea
                          value={workForm.content}
                          onChange={(e) =>
                            setWorkForm({
                              ...workForm,
                              content: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        원인
                        <textarea
                          value={cause}
                          onChange={(e) => setCause(e.target.value)}
                        />
                      </label>
                      <label>
                        조치내용
                        <textarea
                          value={action}
                          onChange={(e) => setAction(e.target.value)}
                        />
                      </label>
                      <label>
                        시험 및 확인내용
                        <textarea
                          value={testResult}
                          onChange={(e) => setTestResult(e.target.value)}
                        />
                      </label>
                      <label>
                        작업 상태
                        <select
                          value={workForm.status}
                          onChange={(e) =>
                            setWorkForm({
                              ...workForm,
                              status: e.target.value as DailyWork["status"],
                            })
                          }
                        >
                          {[
                            "작업예정",
                            "작업중",
                            "작업완료",
                            "관리자확인완료",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <MaterialRows
                      rows={workForm.materials}
                      onChange={(m) =>
                        setWorkForm({
                          ...workForm,
                          materials: m as DailyWork["materials"],
                        })
                      }
                    />
                    <button className="primary-button" disabled={saving}>
                      처리기록 저장
                    </button>
                  </form>
                ) : (
                  <p>
                    예정일과 작업진행자를 배정하면 기존 일일작업에 처리기록이
                    생성됩니다.
                  </p>
                )}
              </>
            ) : tab === "사진" ? (
              <>
                <div className="form-grid">
                  <label>
                    사진 구분
                    <select
                      value={photoPhase}
                      onChange={(e) => setPhotoPhase(e.target.value)}
                    >
                      {AS_PHOTO_PHASES.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    위치
                    <input
                      value={photoLocation}
                      onChange={(e) => setPhotoLocation(e.target.value)}
                    />
                  </label>
                  <label>
                    사진 설명
                    <input
                      value={photoDescription}
                      onChange={(e) => setPhotoDescription(e.target.value)}
                    />
                  </label>
                  <label>
                    촬영일시
                    <input
                      type="datetime-local"
                      value={capturedAt}
                      onChange={(e) => setCapturedAt(e.target.value)}
                    />
                  </label>
                  <label>
                    사진 여러 장
                    <input
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) =>
                        setFileList(Array.from(e.target.files ?? []))
                      }
                    />
                  </label>
                </div>
                <button
                  disabled={saving || !fileList.length}
                  onClick={() =>
                    upload(`photos/${encodeURIComponent(photoPhase)}`, true)
                  }
                >
                  사진 업로드
                </button>
                <div className="as-photos">
                  {AS_PHOTO_PHASES.map((phase) => (
                    <section key={phase}>
                      <h3>{phase}</h3>
                      {detail.photos
                        .filter((p) => p.asPhase === phase)
                        .map((p) => (
                          <article key={p.id}>
                            <button onClick={() => setPreviewPhoto(p.url)}>
                              <img src={p.url} alt={p.description || phase} />
                            </button>
                            <p>
                              {p.location} · {p.description}
                            </p>
                            <small>{p.capturedAt ?? "촬영일시 미상"}</small>
                            <button
                              onClick={() =>
                                perform(
                                  `/${detail.id}/photos/${p.id}`,
                                  undefined,
                                  "DELETE",
                                )
                              }
                            >
                              사진 삭제
                            </button>
                          </article>
                        ))}
                    </section>
                  ))}
                </div>
              </>
            ) : tab === "비용" ? (
              <>
                {detail.financial && (
                  <div className="detail-totals">
                    {[
                      ["원공사 매출", detail.financial.originalRevenue],
                      ["원공사 비용", detail.financial.originalCost],
                      ["이 A/S 발생비용", detail.financial.asCost],
                      ["이 A/S 유상매출", detail.financial.asRevenue],
                      ["현장 전체 차익", detail.financial.totalProfit],
                    ].map(([l, n]) => (
                      <div key={l}>
                        {l}
                        <strong>{Number(n).toLocaleString()}원</strong>
                      </div>
                    ))}
                  </div>
                )}
                <p>
                  A/S 비용을 추가할 때 연결 일일작업에서 아래 처리작업 ID를
                  선택하세요. 무상 A/S도 비용·지급에 반영됩니다.
                </p>
                {detail.works.map((w) => (
                  <p key={w.id}>
                    {w.workDate} · {w.id}
                  </p>
                ))}
                <ExpensesPanel
                  siteId={detail.siteId}
                  onChanged={() => void open(detail.id)}
                />
                <h3>이 A/S에 연결된 지출</h3>
                {detail.expenses?.map((e) => (
                  <p key={e.id}>
                    {e.description} · {e.totalAmount.toLocaleString()}원
                  </p>
                ))}
              </>
            ) : tab === "연결기록" ? (
              <>
                <h3>원공사 연결</h3>
                <p>
                  이전 A/S:{" "}
                  {options?.previous.find((r) => r.id === detail.previousId)
                    ?.number || "없음"}
                </p>
                {detail.quoteIds.map((id) => (
                  <button key={id} onClick={() => onOpenQuote?.(id)}>
                    연결 견적 {id.slice(0, 8)}
                  </button>
                ))}
                {detail.originalWorkIds.map((id) => (
                  <p key={id}>
                    일일작업 {id} ·{" "}
                    {options?.works.find((w) => w.id === id)?.content}
                  </p>
                ))}
                <p>점검지적: {detail.inspectionIds.join(", ") || "없음"}</p>
                <p>사진: {detail.originalPhotoIds.join(", ") || "없음"}</p>
                <p>사용자재: {detail.materialUsageIds.join(", ") || "없음"}</p>
                <p>
                  완료보고서: {detail.completionFileKeys.join(", ") || "없음"}
                </p>
              </>
            ) : tab === "결과보고서" ? (
              <>
                <label>
                  출력 옵션
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    {[
                      "처리결과 + 전후사진",
                      "사진대지만",
                      "처리결과 내역만",
                    ].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <button disabled={saving} onClick={() => report(false)}>
                  PDF 미리보기
                </button>
                <button disabled={saving} onClick={() => report(true)}>
                  PDF 다운로드
                </button>
                {pdfUrl && (
                  <iframe
                    title="A/S 결과보고서 PDF 미리보기"
                    src={pdfUrl}
                    style={{ width: "100%", height: 650, border: 0 }}
                  />
                )}
              </>
            ) : (
              <>
                <label>
                  첨부파일 여러 개
                  <input
                    type="file"
                    multiple
                    onChange={(e) =>
                      setFileList(Array.from(e.target.files ?? []))
                    }
                  />
                </label>
                <button
                  disabled={!fileList.length || saving}
                  onClick={() => upload("attachments")}
                >
                  첨부파일 등록
                </button>
                {detail.attachments.map((a) => (
                  <p key={a.id}>
                    <a
                      href={`/api/after-service/${detail.id}/attachments/${a.id}`}
                    >
                      {a.name}
                    </a>{" "}
                    · {a.size.toLocaleString()}byte
                  </p>
                ))}
              </>
            )}
          </section>
        </>
      ) : (
        <section className="panel as-list">
          <div className="panel-title">
            <div>
              <h2>A/S 관리</h2>
              <p>완료된 공사의 요청부터 결과확인·종결까지 관리하세요.</p>
            </div>
            {options?.canCreate && (
              <button className="primary-button" onClick={() => edit()}>
                A/S 접수
              </button>
            )}
            {options?.canFinance && (
              <button onClick={() => setStatesForm(options.states)}>
                상태 설정
              </button>
            )}
          </div>
          <div className="as-filters">
            <label>
              현장·고객 검색
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label>
              접수자·현장 담당자
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </label>
            {[
              [
                "상태",
                status,
                setStatus,
                options?.states.map((s) => ({
                  value: s.key,
                  label: s.label,
                })) ?? [],
              ],
              [
                "유상/무상",
                billing,
                setBilling,
                ["무상", "유상", "판단보류"].map((s) => ({
                  value: s,
                  label: s,
                })),
              ],
              [
                "A/S 유형",
                type,
                setType,
                AS_TYPES.map((s) => ({ value: s, label: s })),
              ],
              [
                "작업진행자",
                worker,
                setWorker,
                options?.workers.map((w) => ({
                  value: w.id,
                  label: w.displayName,
                })) ?? [],
              ],
            ].map(([l, v, set, items]) => (
              <label key={String(l)}>
                {String(l)}
                <select
                  value={v as string}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                >
                  <option value="">전체</option>
                  {(items as { value: string; label: string }[]).map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              기간 시작
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              기간 종료
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "A/S 번호",
                    "현장명",
                    "고객명",
                    "접수일",
                    "요청내용",
                    "유형",
                    "우선순위",
                    "담당 작업진행자",
                    "예정일",
                    "처리상태",
                    "유상/무상",
                    "완료일",
                  ].map((l) => (
                    <th key={l}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={r.delayed ? "as-delayed" : ""}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => open(r.id)}
                      >
                        {r.number}
                      </button>
                    </td>
                    <td>{r.siteName}</td>
                    <td>{r.customerName}</td>
                    <td>{r.receivedDate}</td>
                    <td>{r.request}</td>
                    <td>{r.type}</td>
                    <td>{r.urgent ? "긴급" : r.priority}</td>
                    <td>{r.managerName}</td>
                    <td>
                      {r.plannedDate || "미정"} {r.plannedStart}
                    </td>
                    <td>
                      {options?.states.find((s) => s.key === r.status)?.label ??
                        r.status}
                      {r.delayed && " · 지연"}
                    </td>
                    <td>{r.billing}</td>
                    <td>{r.completedDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="as-mobile-list">
            {filtered.map((r) => (
              <button key={r.id} onClick={() => open(r.id)}>
                <strong>{r.siteName}</strong>
                <span>
                  {r.location} · {r.request}
                </span>
                <span>
                  {r.plannedDate || "일정 미정"} {r.plannedStart} ·{" "}
                  {r.managerName}
                </span>
                <b>
                  {r.urgent ? "긴급 · " : ""}
                  {r.status} · {r.billing}
                </b>
              </button>
            ))}
          </div>
          {!filtered.length && <p className="empty">등록된 A/S가 없습니다.</p>}
        </section>
      )}
      {previewPhoto && (
        <div
          className="schedule-modal"
          role="dialog"
          aria-modal="true"
          aria-label="A/S 사진 미리보기"
        >
          <section className="panel">
            <button onClick={() => setPreviewPhoto("")}>닫기</button>
            <img
              src={previewPhoto}
              alt="A/S 사진 확대"
              style={{ maxWidth: "100%", maxHeight: "80vh" }}
            />
          </section>
        </div>
      )}
      {statesForm && (
        <div
          className="schedule-modal"
          role="dialog"
          aria-modal="true"
          aria-label="A/S 상태 설정"
        >
          <section className="panel">
            <h2>A/S 상태 설정</h2>
            <p>기본 코드는 유지하고 표시명을 변경할 수 있습니다.</p>
            {statesForm.map((s, i) => (
              <label key={i}>
                {s.key}
                <input
                  value={s.label}
                  onChange={(e) =>
                    setStatesForm(
                      statesForm.map((v, n) =>
                        n === i ? { ...v, label: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              onClick={() => {
                const key = prompt("새 상태명");
                if (key) setStatesForm([...statesForm, { key, label: key }]);
              }}
            >
              상태 추가
            </button>
            <button
              onClick={() =>
                void perform("/settings", { states: statesForm }, "PUT").then(
                  () => setStatesForm(null),
                )
              }
            >
              설정 저장
            </button>
            <button onClick={() => setStatesForm(null)}>닫기</button>
          </section>
        </div>
      )}
    </div>
  );
}

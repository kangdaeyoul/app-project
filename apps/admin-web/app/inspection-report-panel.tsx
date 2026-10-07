"use client";
import { useEffect, useRef, useState } from "react";
import {
  InspectionReport,
  InspectionReportInput,
  InspectionReportSource,
  InspectionItemInput,
  INSPECTION_REPORT_TITLE,
  INSPECTION_OUTPUT_MODES,
  INSPECTION_COVER_TITLES,
} from "@jongno/shared";
import PdfPreview from "./pdf-preview";
const newItem = (number: string): InspectionItemInput => ({
  number,
  location: "",
  photoContent: "",
  inspection: "",
  result: "",
  beforePhotoIds: [],
  afterPhotoIds: [],
});
export default function InspectionReportPanel({ siteId }: { siteId: string }) {
  const [source, setSource] = useState<InspectionReportSource | null>(null),
    [form, setForm] = useState<InspectionReportInput | null>(null),
    [id, setId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState("");
  const url = useRef(""),
    version = useRef(0),
    dirty = useRef(false);
  function clear() {
    version.current++;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
    setPreview("");
    setNotice("");
  }
  function change(patch: Partial<InspectionReportInput>) {
    clear();
    dirty.current = true;
    setForm((f) => (f ? { ...f, ...patch } : f));
  }
  function select(report?: InspectionReport) {
    if (!source) return;
    if (
      dirty.current &&
      !window.confirm("저장하지 않은 작성 내용이 사라집니다. 계속할까요?")
    )
      return;
    clear();
    dirty.current = false;
    setError("");
    setId(report?.id ?? "");
    setForm(
      report
        ? { ...report, items: report.items.map((i) => ({ ...i })) }
        : { ...source.defaults, items: [newItem("1")] },
    );
  }
  useEffect(() => {
    const c = new AbortController();
    fetch(
      `/api/sites/${encodeURIComponent(siteId)}/inspection-reports/source`,
      { signal: c.signal },
    )
      .then(async (r) => {
        if (!r.ok) throw Error("보수결과 보고서를 불러오지 못했습니다.");
        return r.json();
      })
      .then((s: InspectionReportSource) => {
        if (c.signal.aborted) return;
        clear();
        setSource(s);
        const report = s.reports[0];
        setId(report?.id ?? "");
        setForm(report ?? { ...s.defaults, items: [newItem("1")] });
        dirty.current = false;
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => {
      c.abort();
      version.current++;
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, [siteId]);
  function itemChange(index: number, patch: Partial<InspectionItemInput>) {
    if (form)
      change({
        items: form.items.map((i, n) => (n === index ? { ...i, ...patch } : i)),
      });
  }
  async function save() {
    if (!form || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/inspection-reports${id ? "/" + encodeURIComponent(id) : ""}`,
        {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const body = await r.json();
      if (!r.ok) throw Error(body.message || "저장 실패");
      const report = body as InspectionReport;
      setId(report.id);
      setForm(report);
      setSource((s) =>
        s
          ? {
              ...s,
              reports: [report, ...s.reports.filter((r) => r.id !== report.id)],
            }
          : s,
      );
      dirty.current = false;
      setNotice("보고서 초안을 저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  async function render(download: boolean) {
    if (!form || busy) return;
    const current = version.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/inspection-reports/${download ? "generate" : "preview"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      if (!r.ok) {
        const b = await r.json();
        throw Error(b.message || "PDF 생성 실패");
      }
      const blob = await r.blob();
      if (current !== version.current) return;
      if (blob.type !== "application/pdf" || !blob.size)
        throw Error("PDF 파일을 확인할 수 없습니다.");
      const objectUrl = URL.createObjectURL(blob);
      if (download) {
        const name = r.headers
          .get("Content-Disposition")
          ?.match(/filename\*=UTF-8''(.+)$/)?.[1];
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = name
          ? decodeURIComponent(name)
          : "점검지적사항보수결과.pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
        setNotice("점검지적사항 보수결과 PDF를 다운로드했습니다.");
      } else {
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = objectUrl;
        setPreview(objectUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 생성 실패");
    } finally {
      setBusy(false);
    }
  }
  if (!source || !form)
    return (
      <section>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : (
          <p>보고서를 불러오는 중…</p>
        )}
      </section>
    );
  return (
    <section className="report-panel inspection-report">
      <div className="panel-title">
        <div>
          <h3>{INSPECTION_REPORT_TITLE}</h3>
          <p>
            제출용 이행완료 보고서·보수결과·사진대지를 하나의 PDF로 출력합니다.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => select()}
        >
          새 보수결과 보고서
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="report-options">
        <div className="form-grid">
          <label>
            저장된 보고서
            <select
              aria-label="저장된 보수결과 보고서"
              value={id}
              onChange={(e) =>
                select(source.reports.find((r) => r.id === e.target.value))
              }
            >
              <option value="">새 보고서</option>
              {source.reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.workDate} · {r.originalDocumentName || "점검지적사항"} ·{" "}
                  {r.items.length}개 항목
                </option>
              ))}
            </select>
          </label>
          <label>
            출력 모드
            <select
              aria-label="제출문서 출력 모드"
              value={form.outputMode ?? INSPECTION_OUTPUT_MODES[0]}
              onChange={(e) =>
                change({
                  outputMode: e.target
                    .value as InspectionReportInput["outputMode"],
                })
              }
            >
              {INSPECTION_OUTPUT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {(form.outputMode ?? INSPECTION_OUTPUT_MODES[0]) ===
            INSPECTION_OUTPUT_MODES[0] && (
            <>
              <label>
                표지 문서명
                <select
                  aria-label="표지 문서명"
                  value={form.coverTitle ?? INSPECTION_COVER_TITLES[0]}
                  onChange={(e) =>
                    change({
                      coverTitle: e.target
                        .value as InspectionReportInput["coverTitle"],
                    })
                  }
                >
                  {INSPECTION_COVER_TITLES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="full-width">
                이행조치 내용
                <textarea
                  aria-label="이행조치 내용"
                  maxLength={1000}
                  rows={4}
                  value={form.actionSummary ?? ""}
                  onChange={(e) => change({ actionSummary: e.target.value })}
                />
              </label>
              <div className="full-width">
                <button
                  className="secondary-button"
                  onClick={() =>
                    change({
                      actionSummary: form.items
                        .filter((i) => i.result.trim())
                        .map(
                          (i) =>
                            `점검번호 ${i.number}${i.location ? " (" + i.location + ")" : ""}: ${i.result}`,
                        )
                        .join("\n")
                        .slice(0, 1000),
                    })
                  }
                >
                  보수내용으로 이행조치 요약 불러오기
                </button>
              </div>
            </>
          )}
          <label>
            현장명
            <input readOnly value={source.site.name} />
          </label>
          <label>
            공사업체
            <input readOnly value={source.companyName} />
          </label>
          <label>
            작업일자 또는 보수완료일
            <input
              type="date"
              value={form.workDate}
              onChange={(e) => change({ workDate: e.target.value })}
            />
          </label>
          <label>
            보고서 작성일
            <input
              type="date"
              value={form.createdDate}
              onChange={(e) => change({ createdDate: e.target.value })}
            />
          </label>
          <label>
            원본 점검자료명 (선택)
            <input
              maxLength={300}
              value={form.originalDocumentName}
              onChange={(e) => change({ originalDocumentName: e.target.value })}
            />
          </label>
          <label>
            사진 배치
            <select
              aria-label="보수결과 사진 배치"
              value={form.layout}
              onChange={(e) =>
                change({ layout: Number(e.target.value) as 6 | 8 })
              }
            >
              <option value={6}>6장형 · 전후 3쌍</option>
              <option value={8}>8장형 · 전후 4쌍</option>
            </select>
          </label>
        </div>
        <p>
          원본 점검번호를 그대로 유지합니다. 같은 점검번호에 여러 위치가 있으면
          세부항목을 추가하세요. 사진은 원본 비율을 유지합니다. 긴 지적내용은
          페이지를 늘려 전체 내용을 표시합니다.
        </p>
        {form.items.map((item, index) => (
          <section className="inspection-item" key={item.id ?? index}>
            <div className="panel-title">
              <h4>
                점검번호 {item.number || "미입력"}
                {item.location ? ` · ${item.location}` : ""}
              </h4>
              <div className="form-actions">
                <button
                  className="secondary-button"
                  disabled={form.items.length >= 100}
                  onClick={() => {
                    const items = [...form.items];
                    items.splice(index + 1, 0, {
                      ...newItem(item.number),
                      inspection: item.inspection,
                      photoContent: item.photoContent,
                    });
                    change({ items });
                  }}
                >
                  같은 점검번호 세부항목 추가
                </button>
                <button
                  className="secondary-button"
                  disabled={index === 0}
                  onClick={() => {
                    const a = [...form.items];
                    [a[index - 1], a[index]] = [a[index], a[index - 1]];
                    change({ items: a });
                  }}
                >
                  위로
                </button>
                <button
                  className="secondary-button"
                  disabled={index === form.items.length - 1}
                  onClick={() => {
                    const a = [...form.items];
                    [a[index], a[index + 1]] = [a[index + 1], a[index]];
                    change({ items: a });
                  }}
                >
                  아래로
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    if (window.confirm("이 지적사항을 보고서에서 삭제할까요?"))
                      change({
                        items: form.items.filter((_, n) => n !== index),
                      });
                  }}
                >
                  항목 삭제
                </button>
              </div>
            </div>
            <div className="form-grid">
              <label>
                원본 점검번호
                <input
                  aria-label={`지적번호 ${index + 1}`}
                  maxLength={30}
                  value={item.number}
                  onChange={(e) =>
                    itemChange(index, { number: e.target.value })
                  }
                />
              </label>
              <label>
                작업 위치 / 세부 보수항목
                <input
                  aria-label={`작업 위치 ${index + 1}`}
                  maxLength={100}
                  value={item.location ?? ""}
                  onChange={(e) =>
                    itemChange(index, { location: e.target.value })
                  }
                />
              </label>
              <label className="full-width">
                사진내용 (전·후 공통 캡션)
                <input
                  aria-label={`사진내용 ${index + 1}`}
                  maxLength={300}
                  placeholder="예: 옥내소화전 유량계 및 배관"
                  value={item.photoContent ?? ""}
                  onChange={(e) =>
                    itemChange(index, { photoContent: e.target.value })
                  }
                />
              </label>
              <label className="full-width">
                지적사항
                <textarea
                  aria-label={`지적내용 ${index + 1}`}
                  rows={2}
                  maxLength={5000}
                  value={item.inspection}
                  onChange={(e) =>
                    itemChange(index, { inspection: e.target.value })
                  }
                />
              </label>
              <label className="full-width">
                보수내용
                <textarea
                  aria-label={`보수결과 ${index + 1}`}
                  rows={2}
                  maxLength={5000}
                  value={item.result}
                  onChange={(e) =>
                    itemChange(index, { result: e.target.value })
                  }
                />
              </label>
            </div>
            {(["작업 전", "작업 후"] as const).map((stage) => {
              const key =
                  stage === "작업 전" ? "beforePhotoIds" : "afterPhotoIds",
                photos = source.photos.filter((p) => p.type === stage),
                ids = item[key];
              return (
                <div key={stage}>
                  <h4>
                    {stage} 사진 · 선택 {ids.length}장
                  </h4>
                  <div className="report-selection">
                    {photos.map((p) => (
                      <label key={p.id}>
                        <input
                          type="checkbox"
                          aria-label={`${index + 1}번 ${stage} ${p.originalFilename}`}
                          checked={ids.includes(p.id)}
                          onChange={(e) =>
                            itemChange(index, {
                              [key]: e.target.checked
                                ? [...ids, p.id]
                                : ids.filter((id) => id !== p.id),
                            })
                          }
                        />
                        <img src={p.url} alt={p.description} />
                        <span>
                          {p.workDate} · {p.location}
                          <br />
                          {p.description}
                        </span>
                      </label>
                    ))}
                  </div>
                  {!photos.length && (
                    <p>연결 가능한 {stage} 사진이 없습니다.</p>
                  )}
                  {ids
                    .filter((id) => !photos.some((p) => p.id === id))
                    .map((id) => (
                      <label className="error" key={id}>
                        <input
                          type="checkbox"
                          checked
                          aria-label={`${index + 1}번 누락 사진 ${id}`}
                          onChange={() =>
                            itemChange(index, {
                              [key]: ids.filter((v) => v !== id),
                            })
                          }
                        />
                        사용할 수 없는 사진 {id} · 선택 해제해 주세요.
                      </label>
                    ))}
                </div>
              );
            })}
          </section>
        ))}
        <button
          className="secondary-button"
          disabled={form.items.length >= 100}
          onClick={() => {
            let number = 1;
            while (form.items.some((i) => i.number === String(number)))
              number++;
            change({ items: [...form.items, newItem(String(number))] });
          }}
        >
          ＋ 지적사항 추가
        </button>
      </fieldset>
      <div className="form-actions">
        <button
          className="secondary-button"
          disabled={busy || !form.items.length}
          onClick={save}
        >
          보고서 초안 저장
        </button>
        <button
          className="secondary-button"
          disabled={busy || !form.items.length}
          onClick={() => render(false)}
        >
          {busy ? "처리 중…" : "보수결과 미리보기"}
        </button>
        <button
          className="primary-button"
          disabled={busy || !preview}
          onClick={() => render(true)}
        >
          보수결과 PDF 생성
        </button>
      </div>
      {preview && (
        <div className="report-preview">
          <h4>보수결과 보고서 미리보기</h4>
          <PdfPreview url={preview} label={`${INSPECTION_REPORT_TITLE} PDF`} />
          <a href={preview} target="_blank" rel="noreferrer">
            미리보기 새 창으로 열기
          </a>
        </div>
      )}
      {notice && (
        <p className="save-message" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

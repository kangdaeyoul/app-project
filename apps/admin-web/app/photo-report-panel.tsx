"use client";
import PdfPreview from "./pdf-preview";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_COMPANY,
  PHOTO_REPORT_LAYOUTS,
  PhotoReportOptions,
  PhotoView,
  Site,
} from "@jongno/shared";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
export default function PhotoReportPanel({
  siteId,
  revision,
}: {
  siteId: string;
  revision: number;
}) {
  useEffect(() => { const controller=new AbortController(); fetch("/api/company/current",{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>setOptions(o=>({...o,companyName:v.company.name,title:v.company.output.photoReportTitle}))).catch(()=>{}); return ()=>controller.abort(); }, []);
  const [photos, setPhotos] = useState<PhotoView[]>([]);
  const [options, setOptions] = useState<PhotoReportOptions>({
    layout: PHOTO_REPORT_LAYOUTS[0],
    workDate: "",
    type: "",
    selection: "전체 사진",
    photoIds: [],
    title: DEFAULT_COMPANY.output.photoReportTitle,
    companyName: DEFAULT_COMPANY.name,
    workContent: "",
    periodStart: today(),
    periodEnd: today(),
    createdDate: today(),
    showWorker: false,
    showNumber: true,
    showTime: false,
  });
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = useRef("");
  const requestVersion = useRef(0);
  function clearPreview() {
    requestVersion.current++;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
    setPreview("");
    setNotice("");
  }
  function change(patch: Partial<PhotoReportOptions>) {
    clearPreview();
    setOptions((o) => ({ ...o, ...patch }));
  }
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/sites/${siteId}`, { signal: controller.signal }),
      fetch(`/api/photos?siteId=${encodeURIComponent(siteId)}`, {
        signal: controller.signal,
      }),
    ])
      .then(async (responses) => {
        if (responses.some((r) => !r.ok))
          throw Error("사진대지 정보를 불러오지 못했습니다.");
        const [site, list]: [Site, PhotoView[]] = await Promise.all([
          responses[0].json(),
          responses[1].json(),
        ]);
        if (controller.signal.aborted) return;
        clearPreview();
        setPhotos(list);
        setOptions((o) => ({
          ...o,
          workContent: site.description,
          photoIds: [],
          periodStart: list[0]?.workDate || site.startDate,
          periodEnd: list.at(-1)?.workDate || site.endDate,
        }));
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [siteId, revision]);
  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  const eligible = photos.filter(
    (p) =>
      (!options.type || p.type === options.type) &&
      (!options.workDate || p.workDate === options.workDate),
  );
  const count =
    options.selection === "전체 사진"
      ? eligible.length
      : eligible.filter((p) => options.photoIds.includes(p.id)).length;
  async function render(download: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const version = requestVersion.current;
    try {
      const response = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/photo-reports/${download ? "generate" : "preview"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        },
      );
      if (!response.ok) {
        const body = await response.json();
        throw Error(body.message || "PDF 생성 실패");
      }
      const blob = await response.blob();
      if (version !== requestVersion.current) return;
      if (blob.type !== "application/pdf" || !blob.size)
        throw Error("PDF 파일을 확인할 수 없습니다.");
      const objectUrl = URL.createObjectURL(blob);
      if (download) {
        const name = response.headers
          .get("Content-Disposition")
          ?.match(/filename\*=UTF-8''(.+)$/)?.[1];
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = name ? decodeURIComponent(name) : "공사사진대지.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
        setNotice("사진대지 PDF를 다운로드했습니다.");
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
  return (
    <section className="report-panel">
      <div className="panel-title">
        <div>
          <h3>사진대지 PDF 자동생성</h3>
          <p>사진을 고르고 미리보기에서 출력 내용을 확인하세요.</p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="report-options">
        <div className="form-grid">
          <label>
            문서 제목
            <input
              maxLength={100}
              value={options.title}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label>
            회사명
            <input
              maxLength={100}
              value={options.companyName}
              onChange={(e) => change({ companyName: e.target.value })}
            />
          </label>
          <label className="full-width">
            공사명 또는 작업내용
            <textarea
              maxLength={5000}
              rows={2}
              value={options.workContent}
              onChange={(e) => change({ workContent: e.target.value })}
            />
          </label>
          <label>
            작업기간 시작
            <input
              type="date"
              value={options.periodStart}
              onChange={(e) => change({ periodStart: e.target.value })}
            />
          </label>
          <label>
            작업기간 종료
            <input
              type="date"
              value={options.periodEnd}
              onChange={(e) => change({ periodEnd: e.target.value })}
            />
          </label>
          <label>
            작성일
            <input
              type="date"
              value={options.createdDate}
              onChange={(e) => change({ createdDate: e.target.value })}
            />
          </label>
          <label>
            출력형식
            <select
              value={options.layout}
              onChange={(e) =>
                change({
                  layout: e.target.value as PhotoReportOptions["layout"],
                })
              }
            >
              {PHOTO_REPORT_LAYOUTS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            출력 사진 범위
            <select
              value={options.selection}
              onChange={(e) =>
                change({
                  selection: e.target.value as PhotoReportOptions["selection"],
                  photoIds: [],
                })
              }
            >
              <option>전체 사진</option>
              <option>선택한 사진만</option>
            </select>
          </label>
          <label>
            출력 작업일자
            <select
              value={options.workDate}
              onChange={(e) =>
                change({ workDate: e.target.value, photoIds: [] })
              }
            >
              <option value="">전체 작업일자</option>
              {[...new Set(photos.map((p) => p.workDate))].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            출력 사진 구분
            <select
              value={options.type}
              onChange={(e) =>
                change({
                  type: e.target.value as PhotoReportOptions["type"],
                  photoIds: [],
                })
              }
            >
              <option value="">작업 전/후 모두</option>
              <option>작업 전</option>
              <option>작업 후</option>
            </select>
          </label>
        </div>
        <div className="report-checks">
          {(
            [
              ["showWorker", "작업진행자 이름 표시"],
              ["showNumber", "사진번호 표시"],
              ["showTime", "촬영시간 표시"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => change({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
        {options.selection === "선택한 사진만" && (
          <div className="report-selection">
            {eligible.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  aria-label={`${p.originalFilename} 출력 선택`}
                  checked={options.photoIds.includes(p.id)}
                  onChange={(e) =>
                    change({
                      photoIds: e.target.checked
                        ? [...options.photoIds, p.id]
                        : options.photoIds.filter((id) => id !== p.id),
                    })
                  }
                />
                <img src={p.url} alt={p.description} />
                <span>
                  {p.workDate} · {p.type}
                  <br />
                  {p.location} · {p.description}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <p>
        출력 대상 {count}장 · 비교형은 같은 작업일자·위치끼리 배치하며, 짝이
        없는 사진도 출력합니다.
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !count}
          onClick={() => render(false)}
        >
          {busy ? "PDF 준비 중…" : "사진대지 미리보기"}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !preview}
          onClick={() => render(true)}
        >
          PDF 생성
        </button>
      </div>
      {preview && (
        <div className="report-preview">
          <h4>사진대지 미리보기 · {count}장</h4>
          <p>
            아래 실제 PDF의 모든 페이지를 확인한 뒤 PDF 생성 버튼을 누르세요.
          </p>
          <PdfPreview url={preview} />
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

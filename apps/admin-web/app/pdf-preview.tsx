"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
export default function PdfPreview({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setDocument(null);
    setPage(1);
    setError("");
    setLoading(true);
    import("pdfjs-dist")
      .then((pdf) => {
        if (disposed) return;
        pdf.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        task = pdf.getDocument({ url });
        return task.promise;
      })
      .then((doc) => {
        if (doc && !disposed) setDocument(doc);
      })
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      void task?.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!document) return;
    let disposed = false;
    let rendering:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setLoading(true);
    document
      .getPage(page)
      .then((pdfPage) => {
        if (disposed || !canvas.current) return;
        const viewport = pdfPage.getViewport({ scale: 1.35 });
        const element = canvas.current;
        element.width = viewport.width;
        element.height = viewport.height;
        rendering = pdfPage.render({ canvas: element, viewport });
        return rendering.promise;
      })
      .then(() => {
        if (!disposed) setLoading(false);
      })
      .catch((e) => {
        if (!disposed) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      rendering?.cancel();
    };
  }, [document, page]);
  return (
    <div className="pdf-canvas-preview">
      {error && (
        <p role="alert" className="error">
          미리보기를 표시하지 못했습니다: {error}
        </p>
      )}
      {loading && <p role="status">PDF 페이지를 표시하는 중입니다…</p>}
      <div className="report-page-controls">
        <button
          type="button"
          className="secondary-button"
          disabled={!document || page <= 1 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          이전 페이지
        </button>
        <span>
          페이지 {page} / {document?.numPages ?? "…"}
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={!document || page >= document.numPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          다음 페이지
        </button>
      </div>
      <canvas
        ref={canvas}
        aria-label={`사진대지 PDF ${page}페이지`}
        role="img"
      />
    </div>
  );
}

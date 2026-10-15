"use client";
import { useEffect } from "react";
export function inputExample(label: string, type = "text") {
  const text = label.replace(/\s+/g, " ").trim();
  const rules: [RegExp, string][] = [
    [/사업자.*번호/, "예: 123-45-67890"],
    [/회사명/, "예: 주식회사 ○○소방"],
    [/대표자/, "예: 홍길동"],
    [/팩스|전화|연락처|휴대/, "예: 02-1234-5678"],
    [/이메일/, "예: company@example.com"],
    [/홈페이지/, "예: https://example.com"],
    [/주소/, "예: 서울특별시 ○○구 ○○로 123"],
    [/현장명/, "예: ○○빌딩 소방시설 보수공사"],
    [/거래처|공급업체/, "예: ○○건설"],
    [/견적명|견적 제목/, "예: ○○빌딩 소방시설공사 견적"],
    [/수신|담당자|접수자/, "예: 김담당"],
    [/표시명|표시 이름/, "예: 김철수 소장"],
    [/자재코드/, "예: MAT-001"],
    [/자재명|품명|품목명/, "예: 화재감지기(연기식)"],
    [/제조사/, "예: 제조사명"],
    [/규격/, "예: HFIX 1.5SQ"],
    [/단위/, "예: 개 또는 m"],
    [/계약금액|공사금액/, "예: 5,000,000"],
    [/단가|매입가|원가|재료비|노무비|관리비|지원비|경비|시험비/, "예: 35,000"],
    [/수금|입금|지급|공급가액|금액/, "예: 350,000"],
    [/수량|작업량|인원/, "예: 5"],
    [/길이|거리/, "예: 30"],
    [/VAT|세액|부가세/, "예: 35,000"],
    [/이름|성명/, "예: 김철수"],
    [/계좌/, "예: ○○은행 123-456-789"],
    [/업태/, "예: 건설업"],
    [/종목/, "예: 소방시설공사"],
    [/위치/, "예: 3층 복도"],
    [/설비/, "예: 화재감지기"],
    [/공사명|보수명|문서명/, "예: ○○빌딩 감지기 보수공사"],
    [
      /요청|내용|목적|요약|의견|조치|시험|확인/,
      "예: 3층 감지기 설치 후 동작 확인",
    ],
    [/비고|메모|안내문구|설명/, "예: 방문 전 관리실 연락 필요"],
  ];
  return (
    rules.find(([pattern]) => pattern.test(text))?.[1] ??
    (type === "number"
      ? "예: 5"
      : text
        ? "예: " + text.replace(/\*/g, "").trim() + " 입력"
        : undefined)
  );
}
export default function InputGuides() {
  useEffect(() => {
    const annotate = () => {
      document
        .querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement
        >("input,textarea")
        .forEach((el) => {
          if (el.closest(".login-page") || el.disabled) return;
          const type = el instanceof HTMLTextAreaElement ? "textarea" : el.type;
          if (
            !["text", "email", "tel", "url", "number", "textarea"].includes(
              type,
            )
          )
            return;
          if (el.placeholder && !el.dataset.generatedHint) return;
          const label = el.closest("label");
          const clone = label?.cloneNode(true) as HTMLElement | undefined;
          clone
            ?.querySelectorAll("input,textarea,select,button,small")
            .forEach((n) => n.remove());
          const cell=el.closest('td');
          const column=cell?cell.closest('table')?.querySelectorAll('thead th')[cell.cellIndex]?.textContent:undefined;
          const name = clone?.textContent?.trim() || el.getAttribute("aria-label") || column || el.name;
          const example = inputExample(name ?? "", type);
          if (example) {
            el.placeholder = example;
            el.dataset.generatedHint = "true";
          }
        });
    };
    annotate();
    const observer = new MutationObserver(annotate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}

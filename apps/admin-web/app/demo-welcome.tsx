"use client";
import { useEffect, useRef } from "react";
const guides: Record<string, string[]> = {
  admin: ["견적", "현장", "일정", "작업진행자", "정산", "완료보고서"],
  staff: ["배정된 현장", "일정", "사진", "작업내용"],
  worker1: ["오늘 현장", "작업 시작", "사진 등록", "사용자재", "완료 요청"],
  worker2: ["오늘 현장", "작업 시작", "사진 등록", "사용자재", "완료 요청"],
};
export default function DemoWelcome({
  account,
  busy,
  onStart,
  onCancel,
}: {
  account: string;
  busy: boolean;
  onStart: (tutorial: boolean) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="demo-welcome"
      aria-labelledby="demo-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="demo-title">체험판 사용 안내</h2>
      <p>실제 업무와 구분된 예시로 주요 기능을 살펴보세요.</p>
      <h3>기본 사용설정</h3>
      <p>
        {account === "admin"
          ? "실제 사용 시 회사정보, 거래처, 현장, 사용자, 작업진행자, 자재, 견적, 일정을 직접 설정합니다."
          : "실제 사용 시 관리자가 등록·배정한 현장과 일정으로 업무를 시작합니다."}
      </p>
      <h3>체험판에서 미리 입력된 내용</h3>
      <p>
        {account === "admin"
          ? "예시 회사정보 · 거래처 · 현장 · 견적 · 작업진행자 · 일정 · 사진 · 정산 · 완료보고서"
          : account === "staff"
            ? "예시 배정 현장 · 일정 · 사진 · 작업내용"
            : "예시 오늘 현장 · 일정 · 작업지시 · 사진 · 사용자재"}
      </p>
      <p>
        예시 현장을 열어 {(guides[account] ?? []).join(" → ")} 흐름을
        확인하세요. 도움말에서 별도의 튜토리얼 예시를 삭제하거나 다시 불러올 수
        있습니다. 기존 공용 샘플과 실제 입력 자료는 삭제하지 않습니다.
      </p>
      <div className="tutorial-actions">
        <button disabled={busy} onClick={onCancel}>
          취소
        </button>
        <button disabled={busy} onClick={() => onStart(true)}>
          튜토리얼과 함께 시작
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => onStart(false)}
        >
          체험 시작
        </button>
      </div>
    </dialog>
  );
}

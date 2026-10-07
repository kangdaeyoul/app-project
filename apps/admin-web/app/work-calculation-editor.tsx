"use client";
import { useState } from "react";
import { WorkComponent, WorkPrice, WorkQuantityRule } from "@jongno/shared";
const sources: [WorkQuantityRule["source"], string][] = [
  ["quantity", "작업수량 비례"],
  ["locations", "설치 개소 기준"],
  ["wire", "배선 경로 × 가닥 수 + 여유"],
  ["conduit", "전선관 실제길이"],
  ["pipe", "소방배관 실제길이"],
  ["connections", "접속 개소"],
  ["couplings", "연결 개소"],
  ["supports", "길이 ÷ 고정간격 (올림)"],
  ["screws", "고정개소 × 피스 수"],
  ["anchors", "고정개소 × 앵커 수"],
  ["circuits", "회로수"],
  ["fixed", "작업묶음 고정수량"],
  ["baseAdditional", "기본노무 + 추가노무"],
  ["peopleDays", "인원 × 작업일수"],
  ["manual", "관리자 직접 산출"],
];
export default function WorkCalculationEditor({
  component: c,
  prices,
  onChange,
}: {
  component: WorkComponent;
  prices: WorkPrice[];
  onChange: (v: Partial<WorkComponent>) => void;
}) {
  const [open, setOpen] = useState(false),
    [variant, setVariant] = useState(
      c.defaultVariant ?? Object.keys(c.variants ?? {})[0] ?? "",
    );
  const fallback: WorkQuantityRule["source"] = [
    "고정수량",
    "1식",
    "작업묶음 고정수량",
  ].includes(c.mode)
    ? "fixed"
    : ["관리자 직접입력", "수동수량"].includes(c.mode)
      ? "manual"
      : ["길이기준", "현장거리 직접입력"].includes(c.mode)
        ? c.role === "배관"
          ? "pipe"
          : c.role === "전선관"
            ? "conduit"
            : "wire"
        : "quantity";
  const rule = c.quantityRule ?? { source: fallback, factor: c.factor };
  const patch = (v: Partial<WorkQuantityRule>) =>
    onChange({
      quantityRule: { ...rule, ...v },
      ...(v.factor !== undefined ? { factor: v.factor } : {}),
      ...(v.source
        ? {
            mode: (
              {
                quantity: "작업수량에 비례",
                locations: "설치 개소 기준",
                wire: "현장거리 직접입력",
                conduit: "현장거리 직접입력",
                pipe: "현장거리 직접입력",
                connections: "접속 개소 기준",
                couplings: "접속 개소 기준",
                supports: "고정 간격 기준",
                screws: "고정 간격 기준",
                anchors: "고정 간격 기준",
                circuits: "작업수량에 비례",
                fixed: "작업묶음 고정수량",
                baseAdditional: "기본노무 + 추가노무",
                peopleDays: "인원 × 작업일수",
                manual: "수동수량",
              } as Record<WorkQuantityRule["source"], WorkComponent["mode"]>
            )[v.source],
          }
        : {}),
    });
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>산출·규격 연결 설정</summary>
      {open && (
        <>
          <label>
            산출 기준
            <select
              value={rule.source}
              onChange={(e) =>
                patch({ source: e.target.value as WorkQuantityRule["source"] })
              }
            >
              {sources.map(([source, name]) => (
                <option key={source} value={source}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            계산계수
            <input
              type="number"
              min="0"
              step="0.001"
              value={rule.factor}
              onChange={(e) => patch({ factor: Number(e.target.value) })}
            />
          </label>
          {rule.source === "baseAdditional" && (
            <>
              <label>
                예시 기본노무
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={rule.base ?? 0}
                  onChange={(e) => patch({ base: Number(e.target.value) })}
                />
              </label>
              <label>
                수량별 추가노무
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={rule.extra ?? 0}
                  onChange={(e) => patch({ extra: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          <label>
            수동 산출 항목명
            <input
              value={rule.inputKey ?? ""}
              onChange={(e) => patch({ inputKey: e.target.value })}
            />
          </label>
          <label>
            적용조건·규격 선택키
            <input
              value={c.selector ?? ""}
              onChange={(e) => onChange({ selector: e.target.value })}
              placeholder="예: exposed / flexible / kit-complete"
            />
          </label>
          <label>
            공통 작업비 키
            <input
              value={c.commonKey ?? ""}
              onChange={(e) => onChange({ commonKey: e.target.value })}
              placeholder="동일 작업묶음에서는 한 번 적용"
            />
          </label>
          {c.variants && (
            <>
              <p>
                전선관·배관 종류 및 규격별로 실제 자재DB 품목을 연결합니다. 부속
                규격이 맞지 않으면 견적 미리보기에서 경고합니다.
              </p>
              <label>
                규격 선택
                <select
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                >
                  {Object.keys(c.variants).map((key) => (
                    <option key={key}>{key}</option>
                  ))}
                </select>
              </label>
              <label>
                연결 자재
                <select
                  value={c.variants[variant] ?? ""}
                  onChange={(e) =>
                    onChange({
                      variants: { ...c.variants, [variant]: e.target.value },
                      ...(variant === c.defaultVariant
                        ? { priceId: e.target.value }
                        : {}),
                    })
                  }
                >
                  {prices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} / {p.specification} / {p.unit}
                      {p.priceRegistered === false ? " · 단가 미등록" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}
    </details>
  );
}

"use client";
import {
  WorkCondition,
  WORK_CONDITION_KEYS,
  WORK_CONDITION_LABELS,
} from "@jongno/shared";
const boolKeys = [
  "reuseWiring",
  "reusePiping",
  "reuseEquipment",
  "night",
  "demolition",
];
export default function WorkConditionsEditor({
  value,
  onChange,
  label,
}: {
  value: WorkCondition[];
  onChange: (v: WorkCondition[]) => void;
  label: string;
}) {
  return (
    <div className="work-conditions-editor">
      <strong>{label}</strong>
      {value.map((rule, n) => {
        const patch = (v: Partial<WorkCondition>) =>
          onChange(value.map((r, i) => (i === n ? { ...r, ...v } : r)));
        return (
          <div key={n}>
            <select
              aria-label={`${label} 조건 ${n + 1}`}
              value={rule.key}
              onChange={(e) => {
                const key = e.target.value as WorkCondition["key"];
                patch({
                  key,
                  operator: "같음",
                  value: boolKeys.includes(key)
                    ? true
                    : key === "height"
                      ? 3
                      : key === "workType"
                        ? "증설"
                        : key === "installation"
                          ? "노출"
                          : "일반",
                });
              }}
            >
              {WORK_CONDITION_KEYS.map((k) => (
                <option key={k} value={k}>
                  {WORK_CONDITION_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              aria-label={`${label} 비교 ${n + 1}`}
              value={rule.operator}
              onChange={(e) =>
                patch({ operator: e.target.value as WorkCondition["operator"] })
              }
            >
              {(rule.key === "height"
                ? ["같음", "다름", "이상", "이하"]
                : ["같음", "다름"]
              ).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            {boolKeys.includes(rule.key) ? (
              <select
                aria-label={`${label} 값 ${n + 1}`}
                value={String(rule.value)}
                onChange={(e) => patch({ value: e.target.value === "true" })}
              >
                <option value="true">예</option>
                <option value="false">아니오</option>
              </select>
            ) : rule.key === "workType" || rule.key === "installation" ? (
              <select
                aria-label={`${label} 값 ${n + 1}`}
                value={String(rule.value)}
                onChange={(e) => patch({ value: e.target.value })}
              >
                {(rule.key === "workType"
                  ? ["증설", "이설", "신설", "교체"]
                  : ["노출", "매립"]
                ).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            ) : (
              <input
                aria-label={`${label} 값 ${n + 1}`}
                type={rule.key === "height" ? "number" : "text"}
                min="0"
                max="100"
                step="0.001"
                value={String(rule.value)}
                onChange={(e) =>
                  patch({
                    value:
                      rule.key === "height"
                        ? Number(e.target.value)
                        : e.target.value,
                  })
                }
              />
            )}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== n))}
            >
              조건 삭제
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange([...value, { key: "night", operator: "같음", value: true }])
        }
      >
        조건 추가
      </button>
    </div>
  );
}

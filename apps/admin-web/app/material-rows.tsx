"use client";
import { MaterialUsageInput } from "@jongno/shared";
export default function MaterialRows({
  rows,
  onChange,
}: {
  rows: MaterialUsageInput[];
  onChange: (rows: MaterialUsageInput[]) => void;
}) {
  function change(
    index: number,
    key: keyof MaterialUsageInput,
    value: string | number,
  ) {
    onChange(rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  }
  return (
    <section className="materials-editor full-width">
      <div className="panel-title">
        <div>
          <h3>사용자재</h3>
          <p>실제 사용량만 입력하세요. 구매·가격 정보는 연결하지 않습니다.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() =>
            onChange([
              ...rows,
              {
                name: "",
                specification: "",
                quantity: 1,
                unit: "개",
                notes: "",
              },
            ])
          }
        >
          ＋ 사용자재 추가
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>자재명</th>
              <th>규격</th>
              <th>수량</th>
              <th>단위</th>
              <th>비고</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id ?? i}>
                <td>
                  <input
                    aria-label={`자재명 ${i + 1}`}
                    required
                    maxLength={300}
                    value={row.name}
                    onChange={(e) => change(i, "name", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`규격 ${i + 1}`}
                    maxLength={300}
                    value={row.specification}
                    onChange={(e) => change(i, "specification", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`수량 ${i + 1}`}
                    type="number"
                    min="0.001"
                    max="1000000"
                    step="0.001"
                    required
                    value={row.quantity}
                    onChange={(e) =>
                      change(i, "quantity", Number(e.target.value))
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`단위 ${i + 1}`}
                    required
                    maxLength={300}
                    value={row.unit}
                    onChange={(e) => change(i, "unit", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`자재 비고 ${i + 1}`}
                    maxLength={5000}
                    value={row.notes}
                    onChange={(e) => change(i, "notes", e.target.value)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`자재 ${i + 1} 삭제`}
                    onClick={() =>
                      onChange(rows.filter((_, index) => i !== index))
                    }
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="empty">
          사용자재가 없습니다. 추가 버튼으로 여러 줄을 입력하세요.
        </p>
      )}
    </section>
  );
}

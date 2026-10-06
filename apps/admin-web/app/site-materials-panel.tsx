"use client";
import { useEffect, useState } from "react";
import { SiteMaterials } from "@jongno/shared";
export default function SiteMaterialsPanel({ siteId }: { siteId: string }) {
  const [data, setData] = useState<SiteMaterials | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    fetch(`/api/daily-work/site-materials/${encodeURIComponent(siteId)}`, {
      signal: c.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw Error(body.message || "사용자재 조회 실패");
        return body;
      })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [siteId, retry]);
  if (error)
    return (
      <div className="error" role="alert">
        {error}{" "}
        <button onClick={() => setRetry((v) => v + 1)}>다시 시도</button>
      </div>
    );
  if (!data) return <p role="status">사용자재를 불러오는 중입니다…</p>;
  return (
    <div>
      <h3>현장 사용자재 내역</h3>
      <p>
        일일작업에서 등록한 실제 사용량입니다. 구매·원가·경비는 다음 단계에서
        연결합니다.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "작업일자",
                "자재명",
                "규격",
                "수량",
                "단위",
                "등록한 일일작업",
                "대표 작업진행자",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.usages.map((u) => (
              <tr key={u.id}>
                <td>{u.workDate}</td>
                <td>{u.name}</td>
                <td>{u.specification || "—"}</td>
                <td>
                  {u.quantity.toLocaleString("ko-KR", {
                    maximumFractionDigits: 3,
                  })}
                </td>
                <td>{u.unit}</td>
                <td className="description-cell">
                  {u.dailyWorkContent || "작업내용 미입력"}
                  <small>{u.dailyWorkId}</small>
                </td>
                <td>{u.managerDisplayName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.usages.length && (
        <p className="empty">등록된 사용자재가 없습니다.</p>
      )}
      <h3 className="material-total-title">현장 총사용량</h3>
      <p>
        자재명·규격·단위가 같은 항목만 합산합니다. 단위 환산은 하지 않습니다.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>자재명</th>
              <th>규격</th>
              <th>총사용량</th>
              <th>단위</th>
            </tr>
          </thead>
          <tbody>
            {data.totals.map((t) => (
              <tr key={JSON.stringify([t.name, t.specification, t.unit])}>
                <td>{t.name}</td>
                <td>{t.specification || "—"}</td>
                <td>
                  {t.quantity.toLocaleString("ko-KR", {
                    maximumFractionDigits: 3,
                  })}
                </td>
                <td>{t.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

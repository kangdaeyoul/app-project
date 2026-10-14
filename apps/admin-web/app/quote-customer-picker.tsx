"use client";
import { useState } from "react";
import { Customer, QuoteInput } from "@jongro/shared";
const snapshot = (c?: Customer) => ({
  name: c?.name ?? "",
  recipient: c?.name ?? "",
  registrationNumber: c?.registrationNumber ?? "",
  contactName: c?.contactName ?? "",
  phone: c?.phone ?? "",
  address: c?.address ?? "",
});
export default function QuoteCustomerPicker({
  customers,
  quote,
  onChange,
  onCreated,
}: {
  customers: Customer[];
  quote: QuoteInput;
  onChange: (patch: Partial<QuoteInput>) => void;
  onCreated: (c: Customer) => void;
}) {
  const [mode, setMode] = useState(""),
    [search, setSearch] = useState(""),
    [form, setForm] = useState({
      name: "",
      registrationNumber: "",
      contactName: "",
      phone: "",
      address: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const needle = search.replace(/[\s-]/g, "").toLowerCase();
  const matches = customers.filter((c) =>
    [c.name, c.registrationNumber ?? "", c.contactName, c.phone]
      .join(" ")
      .replace(/[\s-]/g, "")
      .toLowerCase()
      .includes(needle),
  );
  return (
    <section className="quote-customer-picker" aria-label="거래처 선택">
      <h3>거래처 선택</h3>
      <p>
        {quote.customerSnapshot?.name ||
          customers.find((c) => c.id === quote.customerId)?.name ||
          "입력 안 함"}
      </p>
      <div className="quote-mode-picker">
        <button
          type="button"
          onClick={() => setMode(mode === "search" ? "" : "search")}
        >
          기존 거래처 검색
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "new" ? "" : "new")}
        >
          새 거래처 등록
        </button>
        <button
          type="button"
          onClick={() => {
            onChange({ customerId: "", customerSnapshot: snapshot() });
            setMode("");
          }}
        >
          입력 안 함
        </button>
      </div>
      {mode === "search" && (
        <>
          <label>
            거래처 검색
            <input
              autoFocus
              aria-label="거래처 검색"
              placeholder="거래처명 · 사업자번호 · 담당자 · 전화번호"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="quote-customer-results">
            {matches.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  onChange({ customerId: c.id, customerSnapshot: snapshot(c) });
                  setMode("");
                }}
              >
                <strong>{c.name}</strong>
                <small>
                  {[c.registrationNumber, c.contactName, c.phone]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
            ))}
            {!matches.length && <p>검색 결과가 없습니다.</p>}
          </div>
        </>
      )}
      {mode === "new" && (
        <div className="form-grid">
          {(
            [
              "name",
              "registrationNumber",
              "contactName",
              "phone",
              "address",
            ] as const
          ).map((k, i) => (
            <label key={k}>
              {
                [
                  "새 거래처명",
                  "사업자등록번호",
                  "담당자명",
                  "전화번호",
                  "거래처 주소",
                ][i]
              }
              <input
                aria-label={
                  [
                    "새 거래처명",
                    "새 사업자등록번호",
                    "새 담당자명",
                    "새 전화번호",
                    "새 거래처 주소",
                  ][i]
                }
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
          <button
            type="button"
            disabled={busy || !form.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await fetch("/api/customers", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(form),
                });
                const c = await r.json();
                if (!r.ok) throw Error(c.message);
                onCreated(c);
                onChange({ customerId: c.id, customerSnapshot: snapshot(c) });
                setMode("");
                setForm({
                  name: "",
                  registrationNumber: "",
                  contactName: "",
                  phone: "",
                  address: "",
                });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            등록하고 선택
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

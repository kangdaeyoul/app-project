"use client";
import { useEffect, useState } from "react";
import {
  DailyWork,
  MaterialUsageInput,
  Site,
  SettlementList,
  QuoteView,
} from "@jongno/shared";
import { authApi, useAuth, SessionHeader } from "./auth-provider";
import AfterServicePanel from "./after-service-panel";
import SchedulePanel from "./schedule-panel";
import InstructionsPanel from "./instructions-panel";
import PhotosPanel from "./photos-panel";
import MaterialRows from "./material-rows";
import CompletionReportPanel from "./completion-report-panel";
import FieldHelper from "./field-helper";
const money = (n: number) => new Intl.NumberFormat("ko-KR").format(n) + "원";
export default function OperationalWorkspace() {
  const { user, company } = useAuth();
  const worker = user?.role === "worker";
  const menus = (
    worker
      ? [
          "오늘 일정",
          "내 현장",
          "A/S",
          "작업지시",
          "사진",
          "작업완료",
          "내 정산",
        ]
      : [
          "일정",
          "허용된 현장",
          "일일작업",
          "견적",
          "사진",
          "완료보고서",
          "A/S",
          "작업지시",
        ]
  ).filter((m) => m !== "견적" || user?.permissions.includes("writeQuotes"));
  if (
    !worker &&
    user?.permissions.some((p) =>
      ["siteFinance", "internalCosts", "workerPayments"].includes(p),
    )
  )
    menus.push("현장 재무");
  const [menu, setMenu] = useState(menus[0]),
    [sites, setSites] = useState<Site[]>([]),
    [works, setWorks] = useState<DailyWork[]>([]),
    [siteId, setSiteId] = useState(""),
    [selected, setSelected] = useState<DailyWork | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [asId, setAsId] = useState<string | undefined>();
  useEffect(() => {
    if (!menus.includes(menu)) {
      setMenu(menus[0]);
      setSelected(null);
      setSiteId("");
    }
  }, [user?.permissions.join(",")]);
  async function load() {
    try {
      const [s, d] = await Promise.all([
        authApi<Site[]>("/operational/sites"),
        authApi<DailyWork[]>("/operational/daily-work"),
      ]);
      setSites(s);
      setWorks(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, [revision]);
  const openSite = (id: string) => {
    setSiteId(id);
    setSelected(null);
    setMenu(worker ? "내 현장" : "허용된 현장");
  };
  const openWork = (w: DailyWork) => {
    setSelected(w);
    setSiteId(w.siteId);
    setMenu(worker ? "작업완료" : "일일작업");
  };
  return (
    <div className="shell operational-shell">
      <aside>
        <div className="brand">
          <span className="brand-icon">
            {company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt="회사 로고"
                width={30}
                height={30}
              />
            ) : (
              company.displayName.slice(0, 1)
            )}
          </span>
          <div>
            {company.displayName}
            <small>현장 업무 공간</small>
          </div>
        </div>
        <nav aria-label="주 메뉴">
          {menus.map((m) => (
            <button
              key={m}
              aria-current={menu === m ? "page" : undefined}
              className={menu === m ? "active" : ""}
              onClick={() => {
                setMenu(m);
                setSelected(null);
                setSiteId("");
                setError("");
                setAsId(undefined);
              }}
            >
              {m}
            </button>
          ))}
        </nav>
      </aside>
      <div className="workspace">
        <header>
          <span>{company.displayName} · 현장관리</span>
          <SessionHeader />
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">MY WORKSPACE</div>
              <h1>{menu}</h1>
              <p>
                {worker
                  ? "본인에게 배정된 현장과 작업을 확인하세요."
                  : "허용된 현장의 업무를 관리하세요."}
              </p>
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {menu.includes("일정") ? (
            <SchedulePanel
              onOpenSite={openSite}
              onOpenWorker={() => {}}
              onChanged={() => setRevision((v) => v + 1)}
            />
          ) : menu === "A/S" ? (
            <AfterServicePanel
              initialAsId={asId}
              onChanged={() => setRevision((v) => v + 1)}
              onOpenQuote={() => setMenu("견적")}
            />
          ) : menu === "작업지시" ? (
            <InstructionsPanel
              onOpen={(s, a) => {
                if (a) {
                  setAsId(a);
                  setMenu("A/S");
                } else openSite(s);
              }}
            />
          ) : menu === "현장 재무" ? (
            <ScopedFinance sites={sites} />
          ) : menu === "견적" ? (
            <StaffQuotes />
          ) : menu === "내 정산" ? (
            <OwnSettlements />
          ) : menu === "완료보고서" ? (
            <>
              <label>
                현장
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                >
                  <option value="">현장 선택</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              {siteId && <CompletionReportPanel key={siteId} siteId={siteId} />}
            </>
          ) : menu === "사진" ? (
            <>
              <label>
                일일작업
                <select
                  value={selected?.id ?? ""}
                  onChange={(e) =>
                    setSelected(
                      works.find((w) => w.id === e.target.value) ?? null,
                    )
                  }
                >
                  <option value="">사진을 등록할 작업 선택</option>
                  {works.map((w) => (
                    <option value={w.id} key={w.id}>
                      {w.workDate} · {w.siteName}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <PhotosPanel
                  key={selected.id}
                  dailyWorkId={selected.id}
                  onChanged={() => setRevision((v) => v + 1)}
                />
              )}
            </>
          ) : selected ? (
            <WorkEditor
              key={selected.id}
              work={selected}
              onChanged={() => {
                setSelected(null);
                setRevision((v) => v + 1);
              }}
            />
          ) : (
            <>
              <FieldHelper title={`${user?.displayName}님, 오늘도 안전하게.`} />
              {menu.includes("현장") && (
                <div className="operational-site-grid">
                  {sites
                    .filter((s) => !siteId || s.id === siteId)
                    .map((s) => (
                      <section className="panel" key={s.id}>
                        <span className="badge">{s.status}</span>
                        <h2>
                          <button
                            className="text-button"
                            onClick={() => setSiteId(s.id)}
                          >
                            {s.name}
                          </button>
                        </h2>
                        <p>{s.address}</p>
                        <p>{s.description}</p>
                        <p>
                          담당자 {s.contactName} ·{" "}
                          {s.phone && <a href={"tel:" + s.phone}>{s.phone}</a>}
                        </p>
                        <p>
                          작업기간 {s.startDate} ~ {s.endDate || "미정"}
                        </p>
                        <p>대표 {s.manager ?? "미배정"}</p>
                      </section>
                    ))}
                </div>
              )}
              {siteId && menu.includes("현장") && (
                <InstructionsPanel siteId={siteId} />
              )}
              <section className="panel">
                <h2>배정된 일일작업</h2>
                <div className="operational-site-grid">
                  {works
                    .filter((w) => !siteId || w.siteId === siteId)
                    .map((w) => (
                      <article className="work-card" key={w.id}>
                        <span className="badge">{w.status}</span>
                        <h3>{w.siteName}</h3>
                        <p>
                          {w.workDate} ·{" "}
                          {w.startTime || w.plannedStartTime || "시간 미정"} ~{" "}
                          {w.endTime || w.plannedEndTime || "미정"}
                        </p>
                        <p>{w.content}</p>
                        <button className="primary" onClick={() => openWork(w)}>
                          작업내용 · 사용자재 · 사진
                        </button>
                      </article>
                    ))}
                </div>
                {!works.length && <p>배정된 작업이 없습니다.</p>}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
export function WorkEditor({
  work,
  onChanged,
}: {
  work: DailyWork;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({
      ...work,
      materials: work.materials as MaterialUsageInput[],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function clock(action: string) {
    setBusy(true);
    setError("");
    try {
      const w = await authApi<DailyWork>(
        `/operational/daily-work/${work.id}/${action}`,
        { method: "POST" },
      );
      setForm({ ...w, materials: w.materials });
      setNotice(
        action === "start"
          ? "현재 시각으로 작업을 시작했습니다."
          : "작업을 종료했습니다. 관리자 확인을 기다립니다.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{work.siteName}</h2>
      <p>
        {work.workDate} · 대표 {work.managerDisplayName}
      </p>
      <div className="form-actions">
        <button
          className="primary"
          disabled={busy || form.status !== "작업예정"}
          onClick={() => clock("start")}
        >
          작업 시작
        </button>
        <button
          className="primary"
          disabled={busy || form.status !== "작업중"}
          onClick={() => clock("finish")}
        >
          작업 종료
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await authApi(`/operational/daily-work/${work.id}`, {
              method: "PUT",
              body: JSON.stringify(form),
            });
            onChanged();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            시작시간
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </label>
          <label>
            종료시간
            <input
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </label>
          <label>
            상태
            <select
              value={form.status}
              onChange={(e) =>
                setForm({
                  ...form,
                  status: e.target.value as DailyWork["status"],
                })
              }
            >
              {["작업예정", "작업중", "작업완료"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          작업내용
          <textarea
            required
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </label>
        <label>
          특이사항
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <MaterialRows
          rows={form.materials}
          onChange={(materials) => setForm({ ...form, materials })}
        />
        <button className="primary" disabled={busy}>
          작업내용 저장 / 완료 요청
        </button>
      </form>
      <PhotosPanel dailyWorkId={work.id} />
    </section>
  );
}
export function OwnSettlements() {
  const [month, setMonth] = useState(() =>
      new Date().toISOString().slice(0, 7),
    ),
    [data, setData] = useState<SettlementList | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    authApi<SettlementList>("/operational/settlements?month=" + month)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [month]);
  return (
    <section className="panel">
      <h2>내 정산내역</h2>
      <label>
        조회 월
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <div className="finance">
            {[
              ["월 지급예정", data.monthly.totalPayable],
              ["월 지급완료", data.monthly.paidAmount],
              ["미지급액", data.totals.unpaidAmount],
            ].map(([label, amount]) => (
              <section key={label}>
                <span>{label}</span>
                <strong>{money(Number(amount))}</strong>
              </section>
            ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>현장</th>
                  <th>작업비</th>
                  <th>자재대납</th>
                  <th>지급예정</th>
                  <th>지급완료</th>
                  <th>미지급</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.siteId}>
                    <td>{r.siteName}</td>
                    <td>{money(r.labor)}</td>
                    <td>{money(r.materialAdvances)}</td>
                    <td>{money(r.totalPayable)}</td>
                    <td>{money(r.paidAmount)}</td>
                    <td>{money(r.unpaidAmount)}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
interface QuoteOptions {
  sites: {
    id: string;
    name: string;
    clientId: string | null;
    client: string;
    address: string;
    description: string;
  }[];
  customers: { id: string; name: string }[];
}
export function StaffQuotes() {
  const [rows, setRows] = useState<QuoteView[]>([]),
    [options, setOptions] = useState<QuoteOptions | null>(null),
    [form, setForm] = useState<any>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    Promise.all([
      authApi<QuoteView[]>("/quotes"),
      authApi<QuoteOptions>("/operational/quote-options"),
    ])
      .then(([q, o]) => {
        setRows(q);
        setOptions(o);
      })
      .catch((e) => setError(e.message));
  }, [revision]);
  function blank() {
    const site = options?.sites[0],
      date = new Date().toISOString().slice(0, 10);
    setForm({
      siteId: site?.id ?? "",
      customerId:
        site?.clientId ??
        options?.customers.find((c) => c.name === site?.client)?.id ??
        "",
      siteName: site?.name ?? "",
      address: site?.address ?? "",
      workContent: site?.description ?? "",
      quoteDate: date,
      validUntil: date,
      status: "작성중",
      generalFee: 0,
      supportFee: 0,
      rounding: "천원 반올림",
      displayUnit: "만원",
      notes: "",
      sections: [
        {
          kind: "전기",
          items: [
            {
              trade: "소방전기",
              name: "",
              specification: "",
              unit: "개",
              quantity: 1,
              saleUnitPrice: 0,
              priceCategory: "재료비",
              notes: "",
            },
          ],
        },
      ],
    });
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>견적 작성</h2>
        <button className="primary" onClick={blank}>
          새 견적 작성
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {form && (
        <form
          className="site-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await authApi(
                form.id ? "/quotes/" + form.id : "/operational/quotes",
                {
                  method: form.id ? "PUT" : "POST",
                  body: JSON.stringify(form),
                },
              );
              setForm(null);
              setRevision((v) => v + 1);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="form-grid">
            <label>
              현장
              <select
                value={form.siteId}
                onChange={(e) => {
                  const s = options?.sites.find((s) => s.id === e.target.value);
                  setForm({
                    ...form,
                    siteId: s?.id,
                    siteName: s?.name,
                    address: s?.address,
                    customerId:
                      s?.clientId ??
                      options?.customers.find((c) => c.name === s?.client)?.id,
                  });
                }}
              >
                {options?.sites.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              견적일
              <input
                type="date"
                required
                value={form.quoteDate}
                onChange={(e) =>
                  setForm({ ...form, quoteDate: e.target.value })
                }
              />
            </label>
            <label>
              유효기간
              <input
                type="date"
                required
                value={form.validUntil}
                onChange={(e) =>
                  setForm({ ...form, validUntil: e.target.value })
                }
              />
            </label>
            <label>
              상태
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {["작성중", "제출완료", "수정요청"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {form.sections.map((s: any, sectionIndex: number) => (
            <fieldset key={sectionIndex}>
              <legend>을지 {s.kind}</legend>
              {s.items.map((item: any, itemIndex: number) => (
                <div className="form-grid" key={itemIndex}>
                  {(
                    [
                      "name",
                      "specification",
                      "unit",
                      "quantity",
                      "saleUnitPrice",
                    ] as const
                  ).map((key, i) => (
                    <label key={key}>
                      {["품명", "규격", "단위", "수량", "판매단가"][i]}
                      <input
                        required={key !== "specification"}
                        type={i > 2 ? "number" : "text"}
                        min={i > 2 ? 0 : undefined}
                        value={item[key] ?? ""}
                        onChange={(e) => {
                          const next = structuredClone(form);
                          next.sections[sectionIndex].items[itemIndex][key] =
                            i > 2 ? Number(e.target.value) : e.target.value;
                          setForm(next);
                        }}
                      />
                    </label>
                  ))}
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const next = structuredClone(form);
                  next.sections[sectionIndex].items.push({
                    trade: "소방" + s.kind,
                    name: "",
                    specification: "",
                    unit: "개",
                    quantity: 1,
                    saleUnitPrice: 0,
                    priceCategory: "재료비",
                    notes: "",
                  });
                  setForm(next);
                }}
              >
                품목 추가
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => {
              if (form.sections.length === 1)
                setForm({
                  ...form,
                  sections: [
                    ...form.sections,
                    {
                      kind: form.sections[0].kind === "기계" ? "전기" : "기계",
                      items: [],
                    },
                  ],
                });
            }}
          >
            기계 / 전기 을지 추가
          </button>
          <label>
            비고
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="button" onClick={() => setForm(null)}>
              취소
            </button>
            <button className="primary">견적 저장</button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>현장</th>
              <th>거래처</th>
              <th>상태</th>
              <th>고객 총액</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td>{q.siteName}</td>
                <td>{q.customerName}</td>
                <td>{q.status}</td>
                <td>{money(q.totals.totalAmount)}</td>
                <td>
                  <button onClick={() => setForm(structuredClone(q))}>
                    수정
                  </button>{" "}
                  <a href={`/api/quotes/${q.id}/pdf`}>견적 PDF</a>{" "}
                  <a href={`/api/quotes/${q.id}/excel`}>Excel</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScopedFinance({ sites }: { sites: Site[] }) {
  const { user } = useAuth();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? ""),
    [data, setData] = useState<Record<string, number> | null>(null),
    [rows, setRows] = useState<SettlementList | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    setRows(null);
    setError("");
    if (!siteId) return;
    authApi<Record<string, number>>("/operational/site-finance/" + siteId)
      .then(setData)
      .catch((e) => setError(e.message));
    if (user?.permissions.includes("workerPayments"))
      authApi<SettlementList>("/operational/site-settlements/" + siteId)
        .then(setRows)
        .catch((e) => setError(e.message));
  }, [siteId, user?.permissions.join(",")]);
  const labels: Record<string, string> = {
    contractAmount: "계약금액",
    collectedAmount: "입금액",
    receivables: "미수금",
    siteProfit: "현장차익",
    directMaterials: "직접 자재구매",
    materialAdvances: "자재대납",
    labor: "작업비",
    other: "기타경비",
    totalExpenses: "총 현장지출",
    unpaidWorkerAmount: "작업진행자 미지급액",
  };
  return (
    <section className="panel">
      <h2>허용된 현장 재무</h2>
      <label>
        현장
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="finance">
          {Object.entries(data)
            .filter(([k]) => labels[k])
            .map(([k, v]) => (
              <section key={k}>
                <span>{labels[k]}</span>
                <strong>{money(v)}</strong>
              </section>
            ))}
        </div>
      )}
      {rows && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>작업진행자</th>
                <th>지급예정</th>
                <th>지급완료</th>
                <th>미지급</th>
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((r) => (
                <tr key={r.workerId}>
                  <td>{r.workerDisplayName}</td>
                  <td>{money(r.totalPayable)}</td>
                  <td>{money(r.paidAmount)}</td>
                  <td>{money(r.unpaidAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

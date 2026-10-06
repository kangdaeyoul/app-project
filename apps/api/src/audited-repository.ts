import { AuditAction, AuditTarget } from "@jongno/shared";
import { AuditRecorder, auditValue } from "./audit-recorder";
type Row = Record<string, any>;
type Kind =
  | "현장"
  | "견적"
  | "작업진행자"
  | "일일작업"
  | "사진"
  | "지출"
  | "finance"
  | "invoice"
  | "file";
const methods: Record<Kind, string[]> = {
  현장: ["create", "update", "archive"],
  견적: ["save", "remove"],
  작업진행자: ["create", "update", "archive", "setAvailability"],
  일일작업: ["save"],
  사진: ["save", "remove", "reorder"],
  지출: ["save", "remove"],
  finance: ["saveReceipt", "removeReceipt", "savePayment", "removePayment"],
  invoice: ["saveSale", "savePurchase", "saveWorker"],
  file: ["put", "remove"],
};
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(auditValue(a)) === JSON.stringify(auditValue(b));
// Wrap the existing company-bound repository. Only successful mutations are captured.
export function auditedRepository<T extends object>(
  repository: T,
  kind: Kind,
  audit: AuditRecorder,
): T {
  const repo = repository as Record<string, any>;
  return new Proxy(repository, {
    get(target, property) {
      if (typeof property !== "string" || !methods[kind].includes(property))
        return Reflect.get(target, property);
      return (...args: any[]) => {
        const payment =
          kind === "finance" &&
          ["savePayment", "removePayment"].includes(property);
        const snapshot = (): Row[] => {
          if (kind === "file") {
            const file = repo.get(args[0]);
            return file
              ? [
                  {
                    id: args[0],
                    storageKey: args[0],
                    originalFilename: Buffer.isBuffer(file)
                      ? String(args[0]).split("/").pop()
                      : (file.originalFilename ?? null),
                    size: Buffer.isBuffer(file)
                      ? file.length
                      : file.buffer.length,
                    mimeType: Buffer.isBuffer(file)
                      ? "application/pdf"
                      : file.mimeType,
                  },
                ]
              : [];
          }
          if (kind === "invoice") {
            const r = args[0],
              subtype =
                property === "saveSale"
                  ? "매출"
                  : property === "savePurchase"
                    ? "매입"
                    : "작업진행자";
            const old =
              property === "saveSale"
                ? repo.sale(r.siteId)
                : property === "savePurchase"
                  ? repo.purchase(r.expenseId)
                  : repo.worker(r.siteId, r.workerId);
            const id = `${subtype}:${r.expenseId ?? r.siteId}${r.workerId ? ":" + r.workerId : ""}`;
            return old ? [{ ...old, id, invoiceType: subtype }] : [];
          }
          if (kind === "finance")
            return payment
              ? repo.payments().map((r: Row) => ({
                  ...r,
                  allocations: repo
                    .allocations()
                    .filter((a: Row) => a.paymentId === r.id),
                }))
              : repo.receipts();
          if (kind === "작업진행자" && property === "setAvailability")
            return [{ id: args[0], availability: repo.availability(args[0]) }];
          return repo.list();
        };
        const before = structuredClone(snapshot());
        const priorSites = new Map(
          before.map((r) => [
            r.id,
            audit.sitesFor(
              (kind === "finance"
                ? payment
                  ? "작업진행자 지급"
                  : "수금"
                : kind === "invoice"
                  ? "세금계산서"
                  : kind === "file"
                    ? "파일"
                    : kind === "지출"
                      ? "경비"
                      : kind) as AuditTarget,
              r,
            ),
          ]),
        );
        const paymentRecord = payment
          ? property === "savePayment"
            ? args[0]
            : before.find((r) => r.id === args[0])
          : null;
        const settlementBefore = paymentRecord
          ? audit.settlementState(paymentRecord.siteId, paymentRecord.workerId)
          : null;
        const result = (
          Reflect.get(target, property) as (...args: any[]) => any
        )(...args);
        const after = structuredClone(snapshot());
        const previous = new Map(before.map((r) => [r.id, r])),
          next = new Map(after.map((r) => [r.id, r]));
        for (const id of new Set([...previous.keys(), ...next.keys()])) {
          const old = previous.get(id) ?? null,
            value = next.get(id) ?? null;
          if (equal(old, value)) continue;
          const r = value ?? old!;
          let targetType: AuditTarget =
            kind === "finance"
              ? payment
                ? "작업진행자 지급"
                : "수금"
              : kind === "invoice"
                ? "세금계산서"
                : kind === "file"
                  ? "파일"
                  : kind === "지출"
                    ? [
                        "회사 직접 자재구매",
                        "작업진행자 대납 자재구매",
                      ].includes(r.type)
                      ? "자재구매"
                      : "경비"
                    : kind;
          let action: AuditAction = !old
            ? targetType === "사진"
              ? "추가"
              : ["수금", "작업진행자 지급"].includes(targetType)
                ? "등록"
                : "생성"
            : !value
              ? payment
                ? "지급취소"
                : "삭제"
              : "수정";
          if (kind === "invoice") action = "상태변경";
          if (property === "archive")
            action = kind === "현장" ? "삭제" : "비활성화";
          if (property === "reorder") action = "순서변경";
          if (old && value && old.status !== value.status) action = "상태변경";
          if (kind === "작업진행자" && property === "setAvailability")
            action = "상태변경";
          if (
            kind === "견적" &&
            value?.convertedSiteId &&
            old?.convertedSiteId !== value.convertedSiteId
          )
            action = "계약전환";
          if (kind === "견적" && audit.action) action = audit.action;
          const siteIds = [
            ...new Set([
              ...(priorSites.get(id) ?? []),
              ...audit.sitesFor(targetType, r),
            ]),
          ];
          audit.record({
            targetType,
            targetId: id,
            action,
            before: old,
            after: value,
            siteIds,
          });
          if (kind === "일일작업") {
            const oldMaterials = new Map(
              (old?.materials ?? []).map((m: Row) => [
                m.id,
                { ...m, siteId: old!.siteId },
              ]),
            ) as Map<string, Row>;
            const newMaterials = new Map(
              (value?.materials ?? []).map((m: Row) => [
                m.id,
                { ...m, siteId: value!.siteId },
              ]),
            ) as Map<string, Row>;
            for (const usageId of new Set([
              ...oldMaterials.keys(),
              ...newMaterials.keys(),
            ])) {
              const b = oldMaterials.get(usageId) ?? null,
                a = newMaterials.get(usageId) ?? null;
              if (equal(b, a)) continue;
              audit.record({
                targetType: "사용자재",
                targetId: usageId,
                action: !b ? "추가" : !a ? "삭제" : "수정",
                before: b,
                after: a,
                siteIds,
              });
            }
          }
          if (
            kind === "지출" &&
            value &&
            (!old ||
              old.evidenceType !== value.evidenceType ||
              old.receiptFileKey !== value.receiptFileKey)
          ) {
            const evidence = (r: Row | null) =>
              r
                ? {
                    siteId: r.siteId,
                    evidenceType: r.evidenceType,
                    receiptFileKey: r.receiptFileKey,
                  }
                : null;
            audit.record({
              targetType: "증빙",
              targetId: id,
              action: "상태변경",
              before: evidence(old),
              after: evidence(value),
              siteIds,
            });
          }
        }
        if (paymentRecord) {
          const settlementAfter = audit.settlementState(
            paymentRecord.siteId,
            paymentRecord.workerId,
          );
          if (!equal(settlementBefore, settlementAfter))
            audit.record({
              targetType: "작업진행자 지급",
              targetId: `${paymentRecord.siteId}:${paymentRecord.workerId}`,
              action: "상태변경",
              before: settlementBefore,
              after: settlementAfter,
              siteIds: [paymentRecord.siteId],
              reason:
                property === "removePayment"
                  ? "지급취소에 따른 정산 변경"
                  : "지급에 따른 정산 변경",
            });
        }
        return result;
      };
    },
  });
}

import { Inject, Injectable } from "@nestjs/common";
import { AfterService, AS_STATUSES } from "@jongro/shared";
import { seoulToday } from "./date";
import { CompanyContext } from "./company-context";
export const AS_REPOSITORY = Symbol("AS_REPOSITORY");
export interface AfterServiceRepository {
  list(): AfterService[];
  find(id: string): AfterService | undefined;
  save(row: AfterService): AfterService;
  settings(): { key: string; label: string }[];
  configure(states: { key: string; label: string }[]): void;
}
// Company-owned process-local collections; no second work/photo/expense storage.
@Injectable()
export class MemoryAfterServiceRepository implements AfterServiceRepository {
  constructor(@Inject(CompanyContext) private context: CompanyContext) { context.onCompanyDisposed(id => this.companies.delete(id)); }
  private companies = new Map<
    string,
    { rows: AfterService[]; states: { key: string; label: string }[] }
  >();
  private partition() {
    const id = this.context.companyId;
    if (!this.companies.has(id))
      this.companies.set(id, {
        rows: this.context.trialSeed(id) ? [trialAfterService(id)] : [],
        states: AS_STATUSES.map((key) => ({ key, label: key })),
      });
    return this.companies.get(id)!;
  }
  list() {
    return structuredClone(this.partition().rows);
  }
  find(id: string) {
    return this.list().find((r) => r.id === id);
  }
  save(row: AfterService) {
    if (row.companyId !== this.context.companyId)
      throw Error("Company mismatch");
    const p = this.partition();
    const i = p.rows.findIndex((r) => r.id === row.id);
    if (i < 0) p.rows.push(structuredClone(row));
    else p.rows[i] = structuredClone(row);
    return structuredClone(row);
  }
  settings() {
    return structuredClone(this.partition().states);
  }
  configure(states: { key: string; label: string }[]) {
    this.partition().states = structuredClone(states);
  }
}

function trialAfterService(companyId: string): AfterService {
  const row: any = {};
  for(const key of ['location','equipment','plannedDate','plannedStart','plannedEnd','notes','previousId','cause','action','testResult','completedDate','result','finalAction'])row[key]='';
  for(const key of ['participantIds','quoteIds','originalWorkIds','inspectionIds','originalPhotoIds','materialUsageIds','completionFileKeys','workIds','generatedQuoteIds','attachments','statusHistory'])row[key]=[];
  for(const key of ['urgent','normalOperation','needsVisit','needsQuote','resultConfirmed'])row[key]=false;
  return {...row,id:'AS-DEMO-001',number:'체험 A/S 001',companyId,siteId:'S001',receivedDate:seoulToday(),receivedBy:'예시 담당자',request:'예시 감지기 상태를 확인해 주세요.',type:'확인방문',priority:'일반',billing:'무상',managerId:'W001',status:'접수',chargeAmount:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),deletedAt:null};
}

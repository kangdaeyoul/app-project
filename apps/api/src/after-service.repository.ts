import { Inject, Injectable } from "@nestjs/common";
import { AfterService, AS_STATUSES } from "@jongno/shared";
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
  constructor(@Inject(CompanyContext) private context: CompanyContext) {}
  private companies = new Map<
    string,
    { rows: AfterService[]; states: { key: string; label: string }[] }
  >();
  private partition() {
    const id = this.context.companyId;
    if (!this.companies.has(id))
      this.companies.set(id, {
        rows: [],
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

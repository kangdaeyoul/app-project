import { AuditLog } from "@jongno/shared";
export const AUDIT_REPOSITORY = Symbol("AUDIT_REPOSITORY");
export interface AuditRepository {
  append(record: AuditLog): void;
  list(companyId: string): AuditLog[];
}
// No update/remove operation: deleting domain data cannot erase these snapshots.
export class MemoryAuditRepository implements AuditRepository {
  private readonly companies = new Map<string, AuditLog[]>();
  append(record: AuditLog) {
    const rows = this.companies.get(record.companyId) ?? [];
    rows.push(structuredClone(record));
    this.companies.set(record.companyId, rows);
  }
  list(companyId: string) {
    return structuredClone(this.companies.get(companyId) ?? []);
  }
}

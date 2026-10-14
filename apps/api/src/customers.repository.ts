import { randomUUID } from "node:crypto";
import { Customer } from "@jongro/shared";
export const CUSTOMERS_REPOSITORY = Symbol("CUSTOMERS_REPOSITORY");
export interface CustomersRepository {
  list(): Customer[];
  find(id: string): Customer | undefined;
  create(input: Omit<Customer, "id">): Customer;
  update(id: string, input: Omit<Customer, "id">): Customer | undefined;
  remove(id: string): void;
}
export class SampleCustomersRepository implements CustomersRepository {
  private records: Customer[] = [
    "종로 오피스",
    "혜화 상가 관리사무소",
    "광화문 빌딩",
    "창신 공동주택",
    "익선 매장",
  ].map((name, i) => ({
    id: `C00${i + 1}`,
    name,
    address: "",
    contactName: "현장 담당자",
    phone: "02-000-0000",
  }));
  constructor(seed = true) {
    if (!seed) {
      this.records = [];
    }
  }
  list() {
    return structuredClone(this.records.filter((c) => !c.deletedAt));
  }
  find(id: string) {
    const c = this.records.find((c) => c.id === id);
    return c && structuredClone(c);
  }
  update(id: string, input: Omit<Customer, "id">) {
    const n = this.records.findIndex((c) => c.id === id);
    if (n < 0) return undefined;
    this.records[n] = { ...input, id };
    return { ...this.records[n] };
  }
  remove(id: string) {
    this.records = this.records.map((c) =>
      c.id === id ? { ...c, deletedAt: new Date().toISOString() } : c,
    );
  }
  create(input: Omit<Customer, "id">) {
    const c = { ...input, id: randomUUID() };
    this.records.push(c);
    return { ...c };
  }
}

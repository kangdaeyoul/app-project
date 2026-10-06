import { randomUUID } from "node:crypto";
import { Customer } from "@jongno/shared";
export const CUSTOMERS_REPOSITORY = Symbol("CUSTOMERS_REPOSITORY");
export interface CustomersRepository {
  list(): Customer[];
  find(id: string): Customer | undefined;
  create(input: Omit<Customer, "id">): Customer;
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
  list() {
    return structuredClone(this.records);
  }
  find(id: string) {
    const c = this.records.find((c) => c.id === id);
    return c && structuredClone(c);
  }
  create(input: Omit<Customer, "id">) {
    const c = { ...input, id: randomUUID() };
    this.records.push(c);
    return { ...c };
  }
}

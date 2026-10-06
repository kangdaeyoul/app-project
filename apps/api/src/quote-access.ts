import { CompanyContext } from './company-context';
// Replace this adapter with a request-scoped policy backed by the authenticated
// user's permissions. The current application explicitly runs as a sample admin.
export const QUOTE_ADMIN_ACCESS = Symbol("QUOTE_ADMIN_ACCESS");
export interface QuoteAdminAccess {
  assertAdmin(): void;
}
export class SampleQuoteAdminAccess implements QuoteAdminAccess {
  constructor(private readonly context: CompanyContext = new CompanyContext()) {}
  assertAdmin() { this.context.assertMember(true); }
}

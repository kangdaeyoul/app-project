/** Never serialize a driver Error: messages, causes and stacks can contain credentials/hosts.
 * Keep only recognized diagnostic phrases, with server-supplied identifiers discarded.
 */
export function safeCoreDbError(error: unknown): {
  code: string;
  message: string;
} {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const raw = typeof value.message === "string" ? value.message : "";
  const network: Record<string, string> = {
    ENOTFOUND: "DNS lookup failed",
    EAI_AGAIN: "DNS lookup temporarily failed",
    ECONNREFUSED: "connection refused",
    ETIMEDOUT: "connection timed out",
    ECONNRESET: "connection reset",
    ENETUNREACH: "network unreachable",
    EHOSTUNREACH: "host unreachable",
    ERR_TLS_CERT_ALTNAME_INVALID:
      "TLS certificate hostname verification failed",
    CERT_HAS_EXPIRED: "TLS certificate has expired",
    DEPTH_ZERO_SELF_SIGNED_CERT: "self-signed TLS certificate",
    SELF_SIGNED_CERT_IN_CHAIN: "self-signed certificate in TLS chain",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "unable to verify TLS certificate chain",
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY:
      "unable to get local TLS certificate issuer",
  };
  const candidate = typeof value.code === "string" ? value.code : "";
  const code =
    /^[0-9A-Z]{5}$/.test(candidate) || Object.hasOwn(network, candidate)
      ? candidate
      : "UNKNOWN";
  if (network[code]) return { code, message: network[code] };
  const phrases: [RegExp, string][] = [
    [/^password authentication failed/i, "password authentication failed"],
    [
      /^permission denied for schema\b/i,
      "permission denied for schema app_core",
    ],
    [
      /^permission denied for (?:table|relation)\b/i,
      "permission denied for table",
    ],
    [/^relation .+ does not exist$/i, "relation does not exist"],
    [/^schema .+ does not exist$/i, "schema does not exist"],
    [/^column .+ does not exist$/i, "column does not exist"],
    [/^Tenant or user not found$/i, "Tenant or user not found"],
    [/^Max client connections reached/i, "Max client connections reached"],
    [/^too many (?:clients|connections)/i, "too many database connections"],
    [/^remaining connection slots/i, "remaining connection slots are reserved"],
    [/^database .+ does not exist$/i, "database does not exist"],
    [/^no pg_hba.conf entry/i, "no pg_hba.conf entry for connection"],
    [
      /^SASL:.*password must be a string/i,
      "SASL authentication requires a password string",
    ],
    [
      /^The server does not support SSL connections$/i,
      "server does not support SSL connections",
    ],
    [
      /^(?:Connection terminated due to connection timeout|timeout exceeded when trying to connect)$/i,
      "connection timed out",
    ],
    [
      /^Connection terminated unexpectedly$/i,
      "connection terminated unexpectedly",
    ],
    [/^canceling statement due to statement timeout$/i, "statement timeout"],
    [/^Query read timeout$/i, "query read timeout"],
  ];
  for (const [pattern, message] of phrases)
    if (pattern.test(raw)) return { code, message };
  // Node may wrap network failures in AggregateError. Inspect a bounded cause without printing it.
  const child = Array.isArray(value.errors) ? value.errors[0] : undefined;
  if (child && child !== error) {
    const nested = child as { code?: unknown };
    if (typeof nested.code === "string" && network[nested.code])
      return { code: nested.code, message: network[nested.code] };
  }
  return {
    code,
    message: "unrecognized database error (raw message withheld for security)",
  };
}

// pg-connection-string 2.x treats these modes as verify-full unless libpq compatibility
// is explicitly enabled. Make the current verification behavior explicit without disabling TLS.
export function coreConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (
      url.searchParams.get("uselibpqcompat") !== "true" &&
      ["prefer", "require", "verify-ca"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    ) {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
    return connectionString;
  } catch {
    throw Error(
      "CORE_DATABASE_URL 형식을 확인하세요. 접속값은 보안상 출력하지 않습니다.",
    );
  }
}

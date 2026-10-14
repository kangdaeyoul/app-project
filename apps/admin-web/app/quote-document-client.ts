export async function fetchQuoteDocument(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    } catch (e) {
      if (attempt === 0 && e instanceof TypeError) continue;
      throw Error("출력 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
    }
    if (attempt === 0 && [500, 502, 503, 504].includes(r.status)) {
      await r.text();
      continue;
    }
    if (!r.ok) {
      let message =
        "견적서를 생성하지 못했습니다. 권한과 연결 상태를 확인하세요.";
      if (r.headers.get("content-type")?.includes("application/json")) {
        const v = await r.json();
        if (r.status < 500 && typeof v.message === "string")
          message = v.message;
      }
      throw Error(message);
    }
    const type = r.headers.get("content-type") ?? "";
    if (
      !type.includes("application/pdf") &&
      !type.includes("spreadsheetml.sheet")
    )
      throw Error("출력 파일 형식이 올바르지 않습니다. 다시 시도하세요.");
    return r;
  }
}

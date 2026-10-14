import { ForbiddenException } from "@nestjs/common";
import { CompanyContext } from "./company-context";
export function materialAccess(
  c: CompanyContext,
  mode: "read" | "edit" | "approve" = "read",
) {
  c.assertMember();
  const i = c.identity;
  const admin = i.memberships.some(
    (m) =>
      m.companyId === c.companyId &&
      m.userId === i.userId &&
      m.role === "admin",
  );
  if (admin) return;
  if (
    i.appRole !== "staff" ||
    (mode !== "read" &&
      !(
        i.permissions?.includes(
          mode === "approve" ? "approveMaterials" : "manageMaterials",
        ) ||
        (mode === "edit" && i.permissions?.includes("approveMaterials"))
      ))
  )
    throw new ForbiddenException(
      mode === "approve"
        ? "자재 최종 승인 권한이 없습니다."
        : "자재 관리 권한이 없습니다.",
    );
}

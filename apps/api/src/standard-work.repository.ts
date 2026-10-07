import { WorkPrice, StandardWork, WorkComponent } from "@jongno/shared";
export const STANDARD_WORK_REPOSITORY = Symbol("STANDARD_WORK_REPOSITORY");
export interface StandardWorkRepository {
  list(): { prices: WorkPrice[]; templates: StandardWork[] };
  find(id: string): StandardWork | undefined;
  get(id: string): StandardWork[];
  save(template: StandardWork): void;
  savePrice(price: WorkPrice): void;
  favorites(): string[];
  saveFavorites(ids: string[]): void;
}
export class MemoryStandardWorkRepository implements StandardWorkRepository {
  private favoriteIds: string[] = [];
  favorites() {
    return [...this.favoriteIds];
  }
  saveFavorites(ids: string[]) {
    this.favoriteIds = [...ids];
  }
  private prices: WorkPrice[] = [];
  private versions: StandardWork[] = [];
  constructor(seed = true) {
    if (seed) {
      this.seed();
      for (const name of [
        "유도등",
        "발신기",
        "시각경보기",
        "스프링클러헤드",
        "소방용전선",
      ]) {
        const p = this.prices.find((p) => p.name === name);
        if (p) this.favoriteIds.push(p.id);
      }
    }
  }
  list() {
    return structuredClone({
      prices: this.prices,
      templates: [...new Set(this.versions.map((t) => t.id))].map((id) =>
        this.versions.filter((t) => t.id === id).at(-1)!,
      ),
    });
  }
  find(id: string) {
    return structuredClone(this.versions.filter((t) => t.id === id).at(-1));
  }
  get(id: string) {
    return structuredClone(this.versions.filter((t) => t.id === id));
  }
  save(template: StandardWork) {
    this.versions.push(
      structuredClone({
        ...template,
        priceSnapshot: this.prices.filter((p) =>
          template.components.some((c) => c.priceId === p.id),
        ),
      }),
    );
  }
  savePrice(price: WorkPrice) {
    const i = this.prices.findIndex((p) => p.id === price.id);
    if (i < 0) this.prices.push(structuredClone(price));
    else this.prices[i] = structuredClone(price);
  }
  private seed() {
    const companyId = "jongno";
    const price = (
      name: string,
      unit = "개",
      cost = 3000,
      category: WorkPrice["category"] = "재료비",
    ) => {
      let p = this.prices.find((p) => p.name === name);
      if (!p) {
        p = {
          id: `PRICE-${this.prices.length + 1}`,
          companyId,
          name,
          specification: "표준 (현장 확인)",
          unit,
          category,
          cost,
          salePrice: Math.round(cost * 1.3),
        };
        this.prices.push(p);
      }
      return p.id;
    };
    const groups = [
      ["화재감지기", ["증설", "이설", "신설"]],
      ["유도등", ["증설", "이설", "신설"]],
      ["스프링클러헤드", ["증설", "이설", "신설"]],
      ["수신반", ["교체", "신설"]],
      ["발신기", ["교체", "신설"]],
      ["발신기세트", ["교체"]],
      ["시각경보기", ["교체", "신설"]],
    ] as const;
    for (const [equipment, actions] of groups)
      for (const action of actions) {
        const components: WorkComponent[] = [];
        const add = (
          name: string,
          role: WorkComponent["role"],
          factor = 1,
          unit = "개",
          mode: WorkComponent["mode"] = "작업수량에 비례",
          omitWhen: WorkComponent["omitWhen"] = [],
        ) => {
          const labor = role.includes("노무");
          components.push({
            id: `C${components.length + 1}`,
            priceId: price(
              name,
              unit,
              labor ? 250000 : role === "시험/시운전" ? 50000 : 3000,
              labor ? "노무비" : role === "시험/시운전" ? "경비" : "재료비",
            ),
            role,
            mode,
            factor,
            lengthKey: role === "배관" ? "배관" : "배선",
            omitWhen,
            customerGroup: ["부속자재", "잡자재"].includes(role)
              ? role === "잡자재"
                ? "잡자재"
                : "부속류"
              : role === "배관"
                ? "배관 및 부속"
                : "",
          });
        };
        add(
          equipment === "발신기세트" ? "발신기" : equipment,
          "주자재",
          1,
          "개",
          "작업수량에 비례",
          equipment === "화재감지기"
            ? ["기존 감지기 재사용"]
            : equipment.startsWith("발신기")
              ? ["기존 발신기 재사용"]
              : [],
        );
        if (equipment === "발신기세트") {
          add("지구경종", "주자재");
          add("표시등", "주자재");
        }
        if (equipment === "스프링클러헤드") {
          add("분기부속", "부속자재");
          add("배관", "배관", 5, "m", "길이기준", ["기존 배관 활용"]);
          for (const n of ["니플", "엘보", "티", "행거/클램프"])
            add(n, "부속자재");
          add("실링재 및 잡자재", "잡자재", 1, "식", "1식");
          add("배관노무", "설치노무", 0.16, "인");
          add("누설/동작시험", "시험/시운전", 1, "식", "1식");
        } else {
          add(
            equipment === "수신반" ? "결선용 전선/제어선" : "소방용전선",
            "배선",
            7,
            "m",
            "길이기준",
            ["기존 간선 활용"],
          );
          add("전선관", "배관", 5, "m", "길이기준", ["기존 배관 활용"]);
          add("단자류", "부속자재", 2);
          if (equipment === "수신반") {
            add("압착단자", "부속자재", 10);
            add("마킹/라벨", "잡자재", 1, "식", "1식");
          }
          add("잡자재", "잡자재", 1, "식", "1식");
          if (["이설", "교체"].includes(action))
            add(`기존 ${equipment} 철거노무`, "철거노무", 0.08, "인");
          add(`신규 ${equipment} 설치노무`, "설치노무", 0.12, "인");
          add("결선노무", "결선노무", 0.04, "인");
          if (equipment === "수신반")
            add("회로확인", "시험/시운전", 1, "식", "1식");
          add("동작시험", "시험/시운전", 1, "식", "1식");
        }
        this.save({
          id: `WORK-${this.versions.length + 1}`,
          companyId,
          name: `${equipment} ${action}`,
          section: equipment === "스프링클러헤드" ? "기계" : "전기",
          version: 1,
          components,
          updatedAt: new Date().toISOString(),
          updatedBy: "샘플 관리자",
          reason: "초기 기준값: 실제 현장 단가·수량 보정 필요",
        });
      }
    for (const [name, specification, unit] of [
      ["화재감지기(연기식)", "연기식", "개"],
      ["화재감지기(차동식)", "차동식", "개"],
      ["백관", "25A", "m"],
      ["백관", "32A", "m"],
    ]) {
      const id = price(
        name === "백관" ? name + " " + specification : name,
        unit,
      );
      const row = this.prices.find((p) => p.id === id)!;
      row.name = name;
      row.specification = specification;
      this.favoriteIds.push(id);
    }
    const setId = price("발신기세트");
    this.favoriteIds.push(setId);
  }
}

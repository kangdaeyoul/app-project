import { createHash } from "node:crypto";
import {
  StandardWork,
  WorkComponent,
  WorkPrice,
  WorkQuantityRule,
} from "@jongno/shared";
import type { StandardWorkRepository } from "./standard-work.repository";
const electrical: [string, string[]][] = [
  ...[
    "화재감지기",
    "유도등",
    "발신기",
    "발신기세트",
    "지구경종",
    "표시등",
    "시각경보기",
    "비상조명등",
    "소방스피커",
    "중계기",
  ].map((n) => [n, ["교체", "증설", "이설", "신설"]] as [string, string[]]),
  ["수신반", ["교체", "이설", "신설"]],
  ["비상방송설비", ["신설", "보수", "교체"]],
  ["자동화재탐지설비", ["회로보수", "간선교체"]],
  ["제연댐퍼", ["모터교체", "결선", "연동보수"]],
];
const mechanical: [string, string[]][] = [
  ["스프링클러헤드", ["교체", "증설", "이설", "신설"]],
  ["스프링클러 조인트", ["교체", "이설", "증설"]],
  ["스프링클러 배관", ["신설", "연장", "이설"]],
  ...[
    "알람밸브",
    "드라이밸브",
    "준비작동식밸브",
    "압력스위치",
    "템퍼스위치",
  ].map((n) => [n, ["교체", "정비"]] as [string, string[]]),
  ["알람밸브", ["보수"]],
  ...["시험밸브", "배수밸브", "송수구"].map(
    (n) => [n, ["신설", "교체"]] as [string, string[]],
  ),
  ["소방배관", ["누수보수", "교체"]],
  ...[
    "소방 주펌프",
    "소방 예비펌프",
    "소방 보조펌프",
    "펌프 모터",
    "압력계",
    "압력챔버",
    "기동용 수압개폐장치",
    "체크밸브",
    "게이트밸브",
    "플렉시블 조인트",
    "소방펌프 제어반",
  ].map((n) => [n, ["교체"]] as [string, string[]]),
  ["펌프 배관", ["보수"]],
  ["물탱크", ["보수", "교체"]],
  ["옥내소화전함", ["교체", "기구 교체"]],
  ["앵글밸브", ["교체"]],
  ["소방호스", ["교체"]],
  ["관창", ["교체"]],
  ["완강기", ["설치", "교체"]],
  ["구조대", ["설치"]],
  ["피난기구 표지", ["교체"]],
];
export const DEFAULT_WORK_NAMES = [...electrical, ...mechanical].flatMap(
  ([name, types]) => types.map((t) => `${name} ${t}`),
);
export function registerDefaultWorks(
  repo: StandardWorkRepository,
  companyId: string,
) {
  let materialCount = 0,
    templateCount = 0;
  const original = repo.list();
  const catalog = new Map(original.prices.map((p) => [p.id, p]));
  const key = (name: string, spec: string, unit: string) =>
    JSON.stringify([name, spec, unit]);
  const hash = (s: string) =>
    createHash("sha256")
      .update(companyId + "|" + s)
      .digest("hex")
      .slice(0, 24);
  const material = (
    name: string,
    spec = "",
    unit = "개",
    category: WorkPrice["category"] = "재료비",
    compatibility?: WorkPrice["compatibility"],
  ) => {
    const id = "JNR-M-" + hash(key(name, spec, unit));
    const known =
      catalog.get(id) ??
      [...catalog.values()].find(
        (p) => p.name === name && p.specification === spec && p.unit === unit,
      );
    if (known) return known.id;
    const p: WorkPrice = {
      id,
      companyId,
      name,
      specification: spec,
      unit,
      category,
      cost: 0,
      salePrice: 0,
      purchasePrice: 0,
      priceRegistered: false,
      notes: "단가 미등록: 관리자가 실거래 기준으로 등록 필요",
      compatibility,
    };
    repo.savePrice(p);
    catalog.set(id, p);
    materialCount++;
    return id;
  };
  const component = (
    list: WorkComponent[],
    name: string,
    role: WorkComponent["role"],
    source: WorkQuantityRule["source"] = "quantity",
    factor = 1,
    spec = "",
    unit = "개",
    category: WorkPrice["category"] = "재료비",
  ) => {
    const c: WorkComponent = {
      id: "C" + (list.length + 1),
      priceId: material(name, spec, unit, category),
      role,
      mode:
        source === "fixed"
          ? "작업묶음 고정수량"
          : source === "manual"
            ? "수동수량"
            : source === "wire" || source === "conduit" || source === "pipe"
              ? "현장거리 직접입력"
              : source === "baseAdditional"
                ? "기본노무 + 추가노무"
                : source === "peopleDays"
                  ? "인원 × 작업일수"
                  : source === "locations"
                    ? "설치 개소 기준"
                    : source === "supports"
                      ? "고정 간격 기준"
                      : source === "connections" || source === "couplings"
                        ? "접속 개소 기준"
                        : "작업수량에 비례",
      factor,
      lengthKey: ["pipe", "conduit"].includes(source) ? "배관" : "배선",
      omitWhen: [],
      customerGroup:
        role === "잡자재"
          ? "잡자재"
          : role === "전선" || (role === "결선노무" && category === "재료비")
            ? "배선 및 부속"
            : ["배관", "배관부속", "전선관"].includes(role)
              ? "배관 및 부속"
              : role.includes("노무")
                ? "설치 및 결선비"
                : role === "부속자재"
                  ? "부속류"
                  : "",
      quantityRule: { source, factor },
    };
    list.push(c);
    return c;
  };
  const variants = (
    c: WorkComponent,
    selector: string,
    entries: [string, string, string, string?, WorkPrice["compatibility"]?][],
  ) => {
    c.selector = selector;
    c.variants = Object.fromEntries(
      entries.map(([v, n, s, u, compat]) => [
        v,
        material(n, s, u ?? "개", "재료비", compat),
      ]),
    );
    c.defaultVariant = entries[0][0];
    c.priceId = c.variants[c.defaultVariant];
  };
  const conduitVariants = (name: string, unit = "개") =>
    ["강재", "SF", "GW"].flatMap((type) =>
      ["16mm", "22mm", "28mm", "36mm"].map(
        (size) =>
          [
            `${type}|${size}`,
            name === "전선관"
              ? (
                  {
                    강재: "강재전선관",
                    SF: "1종금속제가요전선관(SF)",
                    GW: "1종금속제가요전선관(GW)",
                  } as Record<string, string>
                )[type]
              : name,
            `${type} ${size}`,
            unit,
            { family: type, size },
          ] as [string, string, string, string, WorkPrice["compatibility"]],
      ),
    );
  const pipeVariants = (name: string, unit = "개") =>
    ["백관", "CPVC", "동관"].flatMap((type) =>
      ["25A", "32A", "40A", "50A", "65A", "80A", "100A"].flatMap((size) =>
        (type === "CPVC"
          ? ["CPVC"]
          : type === "동관"
            ? ["용접식"]
            : ["나사식", "그루빙", "용접식"]
        ).map(
          (method) =>
            [
              `${type}|${size}|${method}`,
              name === "배관"
                ? (
                    {
                      백관: "배관용탄소강관 백관",
                      CPVC: "CPVC 배관",
                      동관: "동관",
                    } as Record<string, string>
                  )[type]
                : type === "CPVC"
                  ? "CPVC " + name
                  : method === "그루빙"
                    ? "그루브 " + name
                    : method === "용접식"
                      ? "용접 " + name
                      : name,
              `${size} ${method}`,
              unit,
              { family: type, size, method },
            ] as [string, string, string, string, WorkPrice["compatibility"]],
        ),
      ),
    );
  for (const [section, groups] of [
    ["전기", electrical],
    ["기계", mechanical],
  ] as const)
    for (const [equipment, types] of groups)
      for (const action of types) {
        const name = `${equipment} ${action}`,
          seedKey = "jongno-integrated:" + name;
        const existing =
          original.templates.find((t) => t.seedKey === seedKey) ??
          original.templates.find(
            (t) => t.name === name && /^WORK-\d+$/.test(t.id),
          );
        if (existing?.seedKey || existing?.deletedAt) continue;
        const list: WorkComponent[] = [];
        const add = (
          n: string,
          role: WorkComponent["role"],
          source: WorkQuantityRule["source"] = "quantity",
          factor = 1,
          spec = "",
          unit = "개",
          category: WorkPrice["category"] = "재료비",
        ) => component(list, n, role, source, factor, spec, unit, category);
        if (equipment === "화재감지기") {
          const c = add("화재감지기(연기식)", "주자재");
          variants(c, "detector", [
            ["연기식", "화재감지기(연기식)", "연기식 (베이스 포함)"],
            ["차동식", "화재감지기(차동식)", "차동식 (베이스 포함)"],
            ["정온식", "화재감지기(정온식)", "정온식 (베이스 포함)"],
          ]);
        } else if (equipment === "발신기세트") {
          for (const n of ["발신기", "지구경종", "표시등", "발신기함"]) {
            const c = add(n, "주자재");
            c.selector = "kit-individual";
            if (n === "발신기함") c.selector = "kit-box";
          }
          add("발신기세트 완제품", "주자재").selector = "kit-complete";
        } else if (equipment === "수신반") {
          const c = add(
            "P형 수신반",
            "주자재",
            "quantity",
            1,
            "회로수 현장선택",
            "대",
          );
          variants(c, "receiver", [
            ["P형", "P형 수신반", "회로수 현장선택", "대"],
            ["R형", "R형 수신반", "회로수 현장선택", "대"],
            ["복합", "복합수신반", "회로수 현장선택", "대"],
          ]);
        } else if (equipment === "스프링클러헤드") {
          const c = add("스프링클러헤드", "주자재");
          variants(c, "head", [
            ["상향식", "스프링클러헤드", "상향식"],
            ["하향식", "스프링클러헤드", "하향식"],
          ]);
        } else if (
          !["소방배관", "스프링클러 배관", "펌프 배관"].includes(equipment)
        )
          add(
            equipment,
            "주자재",
            "quantity",
            1,
            equipment.includes("펌프")
              ? "용량·접속규격 현장선택"
              : "제품규격 현장선택",
            equipment.includes("펌프") ? "대" : "개",
          );
        if (section === "전기") {
          const control = [
            "수신반",
            "중계기",
            "비상방송설비",
            "소방스피커",
            "제연댐퍼",
          ].includes(equipment);
          const wire = add(
            control ? "회로용 결선전선" : "소방용전선",
            "전선",
            "wire",
            1,
            control ? "회로별 선종 현장확인" : "HFIX 1.5SQ",
            "m",
          );
          if (!control)
            variants(wire, "wire", [
              ["HFIX 1.5SQ", "소방용전선", "HFIX 1.5SQ", "m"],
              ["HFIX 2.5SQ", "소방용전선", "HFIX 2.5SQ", "m"],
            ]);
          else wire.selector = "control-wire";
          const conduit = add(
            "전선관",
            "전선관",
            "conduit",
            1,
            "강재 16mm",
            "m",
          );
          variants(conduit, "conduit", conduitVariants("전선관", "m"));
          for (const [n, source] of [
            ["아웃렛박스", "locations"],
            ["아웃렛박스 커버", "locations"],
            ["전선관 커넥터", "connections"],
            ["전선관 커플링", "couplings"],
            ["새들", "supports"],
          ] as const) {
            const c = add(n, "부속자재", source);
            variants(c, "electrical-accessory:" + n, conduitVariants(n));
          }
          for (const [n, source] of [
            ["피스류", "screws"],
            ["칼블럭", "anchors"],
            ["앵커류", "anchors"],
          ] as const)
            add(n, "부속자재", source).selector = "exposed";
          add("접속단자", "부속자재", "connections");
          add("전기테이프", "잡자재", "fixed", 1, "", "식").selector =
            "misc-detail";
          if (equipment === "수신반") {
            add("단자대", "부속자재", "circuits");
            add("압착단자", "부속자재", "circuits", 2);
            add("마킹 및 라벨", "잡자재", "circuits");
            add("고정철물", "부속자재", "locations");
            add("회로확인", "시험/시운전", "circuits", 1, "", "회로", "경비");
            for (const n of [
              "프로그램 수정",
              "중계기 설정",
              "통신확인",
              "연동시험",
            ]) {
              const c = add(n, "시험/시운전", "fixed", 1, "", "식", "경비");
              c.selector =
                ({ 프로그램수정: "programming" } as Record<string, string>)[
                  n.replaceAll(" ", "")
                ] ??
                (
                  {
                    "중계기 설정": "relaySetup",
                    통신확인: "communicationTest",
                    연동시험: "interlockTest",
                  } as Record<string, string>
                )[n];
            }
          }
          add(
            "천장 타공",
            "설치노무",
            "locations",
            1,
            "",
            "개소",
            "노무비",
          ).selector = "ceilingOpening";
          add(
            "고소작업",
            "설치노무",
            "manual",
            1,
            "",
            "인",
            "노무비",
          ).selector = "highWork";
          const night = add(
            "야간작업 추가노무",
            "설치노무",
            "manual",
            1,
            "",
            "인",
            "노무비",
          );
          night.includeWhen = [{ key: "night", operator: "같음", value: true }];
        } else if (
          equipment === "스프링클러헤드" ||
          equipment === "스프링클러 조인트" ||
          equipment.includes("배관") ||
          equipment.includes("펌프") ||
          equipment.includes("밸브")
        ) {
          const pipe = add("배관", "배관", "pipe", 1, "25A 나사식", "m");
          variants(pipe, "pipe", pipeVariants("배관", "m"));
          for (const n of [
            "티",
            "엘보",
            "소켓",
            "니플",
            "레듀샤",
            "가스켓",
            "전용 접합재",
            "용접 이음쇠",
            "커플링",
          ]) {
            const c = add(n, "배관부속", "manual");
            c.quantityRule!.inputKey = n;
            variants(c, "pipe-accessory:" + n, pipeVariants(n));
          }
          for (const n of ["행거", "클램프"]) add(n, "배관부속", "supports");
          add("실링재", "잡자재", "fixed", 1, "", "식").selector =
            "misc-detail";
          if (equipment === "스프링클러헤드") {
            add("스프링클러 조인트", "부속자재").selector = "flexible";
            add("고정브래킷", "부속자재").selector = "flexible";
          }
          if (equipment.includes("펌프")) {
            for (const n of [
              "플랜지",
              "가스켓(플랜지)",
              "볼트·너트",
              "체크밸브",
              "개폐밸브",
            ])
              add(n, "부속자재", "manual", 1, "접속규격 현장확인");
            add(
              "동력선",
              "전선",
              "wire",
              1,
              "용량별 선종 현장확인",
              "m",
            ).selector = "control-wire";
            add("동력 결선부속", "부속자재", "connections");
          }
        } else {
          const parts: Record<string, string[]> = {
            옥내소화전함: ["고정철물", "소화전함 연결부속"],
            앵글밸브: ["밸브 연결부속", "실링재"],
            소방호스: ["호스 연결부속"],
            완강기: ["완강기 지지대", "앵커류", "완강기 표지"],
            구조대: ["구조대 설치함", "구조대 지지대", "앵커류"],
            "피난기구 표지": ["표지 고정부속"],
          };
          for (const n of parts[equipment] ?? ["연결부속"])
            add(
              n,
              "부속자재",
              n.includes("앵커") ? "manual" : "quantity",
              1,
              equipment === "완강기" || equipment === "구조대"
                ? "높이·제품규격 현장선택"
                : "",
            );
        }
        if (
          ["교체", "이설", "정비", "보수", "누수보수", "기구 교체"].includes(
            action,
          )
        )
          add(
            `${equipment} 철거노무`,
            "철거노무",
            "baseAdditional",
            1,
            "",
            "인",
            "노무비",
          ).quantityRule = {
            source: "baseAdditional",
            factor: 1,
            base: 0.04,
            extra: 0.04,
          };
        add(
          section === "전기" ? "전기공 노무" : "기계공 노무",
          "설치노무",
          "baseAdditional",
          1,
          "",
          "인",
          "노무비",
        ).quantityRule = {
          source: "baseAdditional",
          factor: 1,
          base: 0.12,
          extra: 0.12,
        };
        if (section === "전기" || equipment.includes("펌프"))
          add(
            "결선노무",
            "결선노무",
            equipment === "수신반" ? "circuits" : "quantity",
            0.04,
            "",
            "인",
            "노무비",
          );
        const misc = add(
          section === "전기" ? "전기 잡자재" : "기계 잡자재",
          "잡자재",
          "fixed",
          1,
          "",
          "식",
        );
        misc.commonKey = section + "-공통잡자재";
        misc.selector = "misc-bundle";
        const test = add(
          section === "전기" ? "회로시험 및 동작확인" : "누설시험 및 계통확인",
          "시험/시운전",
          "fixed",
          1,
          "",
          "식",
          "경비",
        );
        test.commonKey = section + "-공통시험";
        repo.save({
          id: existing?.id ?? "JNR-W-" + hash(name),
          companyId,
          name,
          section,
          workType: action,
          integrated: true,
          seedKey,
          reviewStatus: "검토필요",
          description:
            "최초 예시 견적 기준. 법정 표준·확정 시공물량이 아니며 관리자 검토 및 현장산출 필요.",
          baseQuantity: 1,
          unit:
            equipment.includes("펌프") || equipment === "수신반" ? "대" : "개",
          calculation: "현장조건 기반 구성품 산출",
          active: true,
          deletedAt: null,
          conditions: [],
          version: (existing?.version ?? 0) + 1,
          components: list,
          updatedAt: new Date().toISOString(),
          updatedBy: "기본 데이터 등록",
          reason: "종로소방 최초 기준: 검토필요, 단가 임의 생성 없음",
        });
        templateCount++;
      }
  return { materialCount, templateCount };
}

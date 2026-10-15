import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  tutorialSteps,
  sampleSeed,
  tutorialCacheKey,
  TUTORIAL_VERSION,
} from "@jongro/shared";
async function fixture() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  async function login(email: string) {
    const a = request.agent(http);
    await a
      .post("/api/auth/login")
      .send({ login: email, password: "Jongro2026!" })
      .expect(201);
    return a;
  }
  return { app, http, login };
}

test("튜토리얼: 역할별 5~7단계, 미권한 견적 제외, 예시 식별자와 사용자/회사 캐시 분리", () => {
  for (const role of ["admin", "staff", "worker"] as const) {
    const steps = tutorialSteps(role);
    assert(steps.length >= 5 && steps.length <= 7);
    const bundle = sampleSeed("jongro", "user-1", role);
    assert(
      bundle.records.every(
        (r) =>
          r.isTutorialSample &&
          r.id.startsWith("tutorial:") &&
          r.companyId === "jongro" &&
          r.ownerUserId === "user-1",
      ),
    );
    if (role !== "admin") assert(!JSON.stringify(bundle).includes("계약금액"));
  }
  assert(!tutorialSteps("staff", false).some((s) => s.screen === "quotes"));
  assert(
    !sampleSeed("jongro", "staff", "staff", false).records.some(
      (r) => r.kind === "quotes",
    ),
  );
  assert.notEqual(
    tutorialCacheKey("c", "a", "worker"),
    tutorialCacheKey("c", "b", "worker"),
  );
  assert.notEqual(
    tutorialCacheKey("c", "a", "worker"),
    tutorialCacheKey("d", "a", "worker"),
  );
  assert.notEqual(
    tutorialCacheKey("c", "a", "worker"),
    tutorialCacheKey("c", "a", "admin"),
  );
});
test("진행상태·예시 생성/편집/삭제/재생성은 본인 범위에만 적용되며 실제 현장·견적·사진·수금은 보존", async () => {
  const { app, http, login } = await fixture();
  try {
    await request(http).get("/api/tutorial/progress").expect(401);
    const admin = await login("admin@jongro.test"),
      other = await login("admin@demo.test");
    const baseline = async () =>
      Promise.all(
        [
          "/sites",
          "/quotes",
          "/customers",
          "/photos",
          "/expenses",
          "/settlements",
        "/payments-received?siteId=S001",
        ].map(async (p) => {
          const r = await admin.get("/api" + p);
          assert.equal(r.status,200,p);
          return { path: p, status: r.status, body: r.body };
        }),
      );
    const before = await baseline();
    const p = (await admin.get("/api/tutorial/progress").expect(200)).body;
    assert.equal(p.status, "new");
    assert.equal(p.role, "admin");
    assert.equal(
      (await admin.get("/api/tutorial/samples").expect(200)).body.bundle,
      null,
    );
    const bundle = (await admin.post("/api/tutorial/samples").expect(201)).body;
    assert.deepEqual(
      (await admin.post("/api/tutorial/samples").expect(201)).body,
      bundle,
    );
    const site = bundle.records.find((r: any) => r.kind === "sites");
    await admin
      .put("/api/tutorial/samples/" + encodeURIComponent(site.id))
      .send({ fields: { 현장명: "[예시] 수정" } })
      .expect(200);
    await admin
      .put("/api/tutorial/progress")
      .send({ version: TUTORIAL_VERSION, status: "completed", step: 6 })
      .expect(200);
    assert.equal(
      (await admin.get("/api/tutorial/progress")).body.status,
      "completed",
    );
    assert.equal(
      (await other.get("/api/tutorial/progress")).body.status,
      "new",
    );
    await other
      .put("/api/tutorial/samples/" + encodeURIComponent(site.id))
      .send({ fields: { 현장명: "침입" } })
      .expect(400);
    await admin
      .put("/api/tutorial/samples/" + encodeURIComponent(site.id))
      .send({ fields: { isTutorialSample: false } })
      .expect(400);
    const photo=bundle.records.find((r:any)=>r.kind==='photos');
    const modifiedPhoto=(await admin.put('/api/tutorial/samples/'+encodeURIComponent(photo.id)).send({fields:{설명:'예시 사진 설명 수정',추가사진수:1}}).expect(200)).body;
    assert.equal(modifiedPhoto.fields.작업전,photo.fields.작업전);
    await admin.put('/api/tutorial/samples/'+encodeURIComponent(photo.id)).send({fields:{작업전:'/private/real-photo'}}).expect(400);
    await admin.delete("/api/tutorial/samples").expect(200);
    await admin.delete("/api/tutorial/samples").expect(200);
    assert.equal((await admin.get("/api/tutorial/samples")).body.bundle, null);
    assert.equal(
      (await admin.get("/api/tutorial/progress")).body.status,
      "completed",
    );
    assert.deepEqual(await baseline(), before);
    const recreated = (await admin.post("/api/tutorial/samples").expect(201))
      .body;
    assert.equal(
      recreated.records.find((r: any) => r.kind === "sites").fields.현장명,
      "[예시] ○○빌딩",
    );
    assert.deepEqual(await baseline(), before);
    await admin
      .put("/api/tutorial/progress")
      .send({ version: 1, status: "completed", step: 7 })
      .expect(400);
    await admin
      .put("/api/tutorial/progress")
      .send({ version: 1, status: "completed", step: 0, userId: "other" })
      .expect(400);
    await admin
      .get("/api/tutorial/progress")
      .set("x-company-id", "demo-company")
      .expect(403);
  } finally {
    await app.close();
  }
});
test("작업진행자는 본인 진행·예시만 관리하고 건너뛰기/초기화는 실제 데이터에 영향이 없다", async () => {
  const { app, login } = await fixture();
  try {
    const a = await login("worker1@jongro.test"),
      b = await login("worker2@jongro.test");
    const seed = (await a.post("/api/tutorial/samples").expect(201)).body;
    const own = seed.records.find((r: any) => r.kind === "work");
    await b
      .put("/api/tutorial/samples/" + encodeURIComponent(own.id))
      .send({ fields: { 상태: "작업중" } })
      .expect(400);
    await a
      .put("/api/tutorial/samples/" + encodeURIComponent(own.id))
      .send({ fields: { 상태: "작업중" } })
      .expect(200);
    await a
      .put("/api/tutorial/progress")
      .send({ version: 1, status: "skipped", step: 2 })
      .expect(200);
    assert.equal((await b.get("/api/tutorial/progress")).body.status, "new");
    await a
      .put("/api/tutorial/progress")
      .send({ version: 1, status: "new", step: 0 })
      .expect(200);
    assert.equal(
      (await a.get("/api/tutorial/samples")).body.bundle.records.length,
      seed.records.length,
    );
    const relogged = await login("worker1@jongro.test");
    assert.equal(
      (await relogged.get("/api/tutorial/progress")).body.status,
      "new",
    );
    assert.equal(
      (await relogged.get("/api/tutorial/progress")).body.role,
      "worker",
    );
  } finally {
    await app.close();
  }
});

test('주요 입력 예시는 필드에 맞는 placeholder 문자열만 반환한다',async()=>{const{inputExample}=await import('../../admin-web/app/input-guides');for(const[label,text]of [['회사명','○○소방'],['대표자','홍길동'],['사업자등록번호','123-45-67890'],['주소','서울특별시'],['이메일','company@example.com'],['현장명','○○빌딩'],['거래처명','○○건설'],['담당자','김담당'],['자재명','화재감지기'],['단가','35,000'],['수량','5']]){assert(inputExample(label)?.includes(text),label);}assert.equal(inputExample('', 'number'),'예: 5');});

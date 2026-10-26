import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { fixture } from "./supabase-fixture";
test("login config: email default, explicit Google opt-in, unavailable providers always hidden", async () => {
  const f = await fixture();
  try {
    delete process.env.AUTH_EMAIL_ENABLED;
    delete process.env.AUTH_GOOGLE_ENABLED;
    const config = async () =>
      (await request(f.a.getHttpServer()).get("/api/auth/config").expect(200))
        .body;
    let v = await config();
    assert.equal(v.loginProviders.emailEnabled, true);
    assert.equal(v.loginProviders.googleEnabled, false);
    for (const key of [
      "kakaoEnabled",
      "naverEnabled",
      "phoneEnabled",
      "appleEnabled",
    ])
      assert.equal(v.loginProviders[key], false);
    process.env.AUTH_GOOGLE_ENABLED = "true";
    assert.equal((await config()).loginProviders.googleEnabled, true);
    process.env.AUTH_EMAIL_ENABLED = "false";
    assert.equal((await config()).loginProviders.emailEnabled, false);
    process.env.AUTH_GOOGLE_ENABLED = "1";
    assert.equal((await config()).loginProviders.googleEnabled, false);
    process.env.AUTH_EMAIL_ENABLED = "invalid";
    assert.equal((await config()).loginProviders.emailEnabled, false);
    process.env.AUTH_EMAIL_ENABLED = "true";
    process.env.AUTH_GOOGLE_ENABLED = "true";
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    try {
      v = await config();
      assert.equal(v.loginProviders.emailEnabled, false);
      assert.equal(v.loginProviders.googleEnabled, false);
    } finally {
      process.env.SUPABASE_PUBLISHABLE_KEY = key;
    }
  } finally {
    await f.close();
  }
});

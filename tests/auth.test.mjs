import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError, COOKIE, clearCookie, forget, login, readToken, sessionCookie, verify } from "../lib/server/auth.ts";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
/** Порталын хариуг дуурайна, дуудлагуудыг бүртгэнэ */
function fakePortal(routes) {
  const calls = [];
  const f = async (url, init) => {
    const path = String(url).split("/sharing/rest/")[1];
    calls.push({ path, body: Object.fromEntries(init.body), referer: init.headers.Referer });
    return routes[path]();
  };
  return { f, calls };
}
const ok = () => fakePortal({
  generateToken: () => json({ token: "tok-1", expires: Date.now() + 3600000 }),
  "community/self": () => json({ username: "bat", fullName: "Бат Болд" }),
});

test("login: token, хэрэглэгчийн нэрийг буцаана, нууц үгийг зөвхөн generateToken-д илгээнэ", async () => {
  const { f, calls } = ok();
  const r = await login(" bat ", "fake-value", f);
  assert.equal(r.token, "tok-1");
  assert.deepEqual(r.user, { username: "bat", fullName: "Бат Болд" });
  assert.equal(calls[0].body.username, "bat");
  assert.equal(calls[0].body.client, "referer");
  assert.equal(calls[0].body.referer, calls[1].referer); // token-ыг ижил Referer-ээс ашиглана
  assert.equal(calls[1].body.password, undefined);
});

test("login: буруу нууц үг 401, порталын англи алдааг ил гаргахгүй", async () => {
  const { f } = fakePortal({ generateToken: () => json({ error: { code: 400, message: "Unable to generate token.", details: ["Invalid username or password."] } }) });
  await assert.rejects(login("bat", "bad", f), (e) => e instanceof AuthError && e.status === 401 && e.message.includes("буруу"));
});

test("login: хоосон, буруу төрлийн утгыг порталд илгээхгүй", async () => {
  const { f, calls } = ok();
  for (const [u, p] of [["", "x"], ["bat", ""], [null, "x"], ["bat", 5], ["   ", "x"]]) {
    await assert.rejects(login(u, p, f), (e) => e.status === 400);
  }
  assert.equal(calls.length, 0);
});

test("login: портал холбогдохгүй бол 503", async () => {
  await assert.rejects(login("bat", "x", async () => { throw new TypeError("fetch failed"); }), (e) => e.status === 503);
  await assert.rejects(login("bat", "x", async () => new Response("<html>", { status: 502 })), (e) => e.status === 503);
});

test("verify: хүчингүй token null, хоосон бол порталд хандахгүй", async () => {
  const { f, calls } = fakePortal({ "community/self": () => json({ error: { code: 498, message: "Invalid token." } }) });
  assert.equal(await verify("bad-token", f), null);
  assert.equal(calls.length, 1);
  assert.equal(await verify(null, f), null);
  assert.equal(calls.length, 1);
});

test("verify: нэргүй (anonymous) хариуг нэвтэрсэнд тооцохгүй", async () => {
  const { f } = fakePortal({ "community/self": () => json({ culture: "en" }) });
  assert.equal(await verify("anon-token", f), null);
});

test("verify: кэшлэнэ, гарсны дараа дахин шалгана", async () => {
  const { f, calls } = fakePortal({ "community/self": () => json({ username: "bat" }) });
  assert.equal((await verify("cache-token", f)).fullName, "bat");
  await verify("cache-token", f);
  assert.equal(calls.length, 1);
  forget("cache-token");
  await verify("cache-token", f);
  assert.equal(calls.length, 2);
});

test("verify: портал унасан бол нэвтрээгүй биш, 503", async () => {
  await assert.rejects(verify("down-token", async () => { throw new TypeError("x"); }), (e) => e.status === 503);
});

test("күүки: httpOnly, SameSite, https дээр Secure, уншиж чадна", () => {
  const http = new Request("http://localhost:3001/x"), https = new Request("https://app.mn/x");
  const c = sessionCookie(http, "a b/c", Date.now() + 60000);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.doesNotMatch(c, /Secure/);
  assert.match(sessionCookie(https, "t", Date.now() + 60000), /Secure/);
  assert.match(clearCookie(http), /Max-Age=0/);
  const req = new Request("http://x/", { headers: { cookie: `other=1; ${COOKIE}=${c.split(";")[0].split("=")[1]}` } });
  assert.equal(readToken(req), "a b/c");
  assert.equal(readToken(new Request("http://x/")), null);
});

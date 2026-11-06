import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthError, REFERER } from "../lib/server/auth.ts";
import { fetchPlanData, listPlanItems, savePlanItem } from "../lib/server/portalPlans.ts";
import { PLAN_KEYWORD, PLAN_TAG, packPlan, toPlanView, unpackPlan } from "../lib/savedPlan.ts";
import { zipText } from "../lib/portalZip.ts";

const ID = "a".repeat(32), OTHER = "b".repeat(32);
const session = { token: "tok", user: { username: "bat", fullName: "Бат" } };
const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });
const file = new Blob(["PK-zip"], { type: "application/zip" });

/** Порталын хариуг дуурайна, дуудлагуудыг бүртгэнэ. routes[зам] нь функц. */
function fakePortal(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), path = u.pathname.split("/sharing/rest/")[1];
    const body = init.body ? Object.fromEntries(init.body) : Object.fromEntries(u.searchParams);
    calls.push({ path, body, method: init.method ?? "GET", referer: init.headers?.Referer });
    const route = routes[path];
    if (!route) throw new Error(`Хүлээгдээгүй дуудлага: ${path}`);
    return route(body);
  };
  return { f, calls };
}
const base = "content/users/bat";

test("хадгалах: хавтас үүсгэж Code Sample нэмээд байгууллагад хуваалцана", async () => {
  const { f, calls } = fakePortal({
    [base]: () => json({ folders: [] }),
    [`${base}/createFolder`]: () => json({ folder: { id: "f1" } }),
    [`${base}/f1/addItem`]: () => json({ id: ID }),
    [`${base}/f1/items/${ID}/share`]: () => json({ notSharedWith: [] }),
  });
  const r = await savePlanItem(session, { file, title: "Загвар", snippet: "100 хүн" }, f);
  assert.equal(r.item.id, ID);
  assert.equal(r.item.owner, "bat");
  assert.equal(r.shared, true);
  const add = calls.find((c) => c.path.endsWith("addItem")).body;
  assert.equal(add.type, "Code Sample");
  assert.equal(add.tags, PLAN_TAG);
  assert.match(add.typeKeywords, new RegExp(PLAN_KEYWORD));
  assert.equal(add.file.name, "settlement-plan.zip");
  const share = calls.find((c) => c.path.endsWith("share")).body;
  assert.equal(share.org, "true");
  assert.equal(share.everyone, "false");
  assert.ok(calls.every((c) => c.referer === REFERER && c.body.token === "tok"));
});

test("хадгалах: байгаа хавтсыг дахин үүсгэхгүй", async () => {
  const { f, calls } = fakePortal({
    [base]: () => json({ folders: [{ id: "f9", title: "Хот төлөвлөлт" }] }),
    [`${base}/f9/addItem`]: () => json({ id: ID }),
    [`${base}/f9/items/${ID}/share`]: () => json({}),
  });
  await savePlanItem(session, { file, title: "Т", snippet: "" }, f);
  assert.ok(!calls.some((c) => c.path.endsWith("createFolder")));
});

test("хадгалах: өөрийн item-ийг байгаа хавтсанд нь шинэчилнэ", async () => {
  const { f, calls } = fakePortal({
    [`content/items/${ID}`]: () => json({ owner: "bat", ownerFolder: "f2", typeKeywords: [PLAN_KEYWORD, "v1"] }),
    [`${base}/f2/items/${ID}/update`]: () => json({ success: true }),
    [`${base}/f2/items/${ID}/share`]: () => json({}),
  });
  const r = await savePlanItem(session, { file, title: "Т", snippet: "", itemId: ID }, f);
  assert.equal(r.item.id, ID);
  assert.ok(!calls.some((c) => c.path.endsWith("addItem")));
});

for (const [label, item] of [
  ["бусдын", () => json({ owner: "dorj", typeKeywords: [PLAN_KEYWORD] })],
  ["төлөвлөгөө биш", () => json({ owner: "bat", typeKeywords: ["other"] })],
  ["устсан", () => json({ error: { code: 400, message: "Item does not exist or is inaccessible." } })],
]) {
  test(`хадгалах: ${label} item-ийг дарж бичихгүй, шинээр үүсгэнэ`, async () => {
    const { f, calls } = fakePortal({
      [`content/items/${ID}`]: item,
      [base]: () => json({ folders: [{ id: "f1", title: "Хот төлөвлөлт" }] }),
      [`${base}/f1/addItem`]: () => json({ id: OTHER }),
      [`${base}/f1/items/${OTHER}/share`]: () => json({}),
    });
    const r = await savePlanItem(session, { file, title: "Т", snippet: "", itemId: ID }, f);
    assert.equal(r.item.id, OTHER);
    assert.ok(!calls.some((c) => c.path.endsWith("update")));
  });
}

test("хадгалах: хуваалцах алдаа хадгалалтыг унагахгүй, мэдээлнэ", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { f } = fakePortal({
      [base]: () => json({ folders: [{ id: "f1", title: "Хот төлөвлөлт" }] }),
      [`${base}/f1/addItem`]: () => json({ id: ID }),
      [`${base}/f1/items/${ID}/share`]: () => json({ error: { code: 403, message: "no" } }),
    });
    assert.equal((await savePlanItem(session, { file, title: "Т", snippet: "" }, f)).shared, false);
  } finally { console.warn = warn; }
});

test("алдаа: хугацаа дууссан token 401, эрхгүй 403, холбогдохгүй 503", async () => {
  const add = (error) => fakePortal({
    [base]: () => json({ folders: [{ id: "f1", title: "Хот төлөвлөлт" }] }),
    [`${base}/f1/addItem`]: () => json({ error }),
  }).f;
  const save = (f) => savePlanItem(session, { file, title: "Т", snippet: "" }, f);
  await assert.rejects(save(add({ code: 498, message: "Invalid token." })), (e) => e instanceof AuthError && e.status === 401);
  await assert.rejects(save(add({ code: 403, message: "denied" })), (e) => e.status === 403 && e.message.includes("эрх"));
  await assert.rejects(save(async () => { throw new TypeError("fetch failed"); }), (e) => e.status === 503);
});

test("жагсаалт: tag, түлхүүр үгээр хайж хэрэгтэй талбарыг буцаана", async () => {
  const { f, calls } = fakePortal({ search: () => json({ results: [{ id: ID, title: "А", owner: "dorj", modified: 5, size: 9, snippet: "s", url: "x", extra: 1 }] }) });
  assert.deepEqual(await listPlanItems(session, f), [{ id: ID, title: "А", owner: "dorj", modified: 5, size: 9, snippet: "s" }]);
  assert.ok(calls[0].body.q.includes(PLAN_TAG) && calls[0].body.q.includes(PLAN_KEYWORD));
});

test("татах: 200-аар ирсэн JSON алдааг файл гэж дамжуулахгүй", async () => {
  const { f } = fakePortal({ [`content/items/${ID}/data`]: () => json({ error: { code: 403, message: "denied" } }) });
  await assert.rejects(fetchPlanData(session, ID, f), (e) => e.status === 403);
  const ok = fakePortal({ [`content/items/${ID}/data`]: () => new Response(new Uint8Array([0x50, 0x4b]), { headers: { "Content-Type": "application/zip" } }) });
  assert.equal((await fetchPlanData(session, ID, ok.f)).status, 200);
});

const plan = () => ({
  wkid: 32648, notes: ["n"], t: { pop: 100 }, site: [], siteArea: 1, bldgs: [{ id: 1 }], nets: { water: null }, streets: [], zones: [],
  dem: { z: new Float64Array(10) }, graph: {}, ibah: { earth: new Map() },
  scene: { streets: [], base: [], over: [], marks: [], lanes: [], masses: [], trees: [], lights: [], lotBcr: new Map(), rep: {} },
});
const draft = () => ({ name: "Т", target: { rings: [[[100, 47], [101, 47], [101, 48], [100, 47]]], region: null }, inputs: { pop: 100 }, plan: plan(), checks: [{ label: "c" }] });

test("багц: zip-ээр буцаж уншигдана, тооцооны өгөгдөл хадгалагдахгүй", async () => {
  const b = await unpackPlan(await packPlan(draft()));
  assert.equal(b.kind, PLAN_KEYWORD);
  assert.deepEqual(b.target, draft().target);
  assert.equal(b.plan.t.pop, 100);
  assert.equal(b.plan.wkid, 32648);
  assert.deepEqual(b.checks, [{ label: "c" }]);
  for (const k of ["dem", "graph", "ibah"]) assert.equal(k in b.plan, false);
  assert.equal("lotBcr" in b.plan.scene, false);
  assert.deepEqual(Object.keys(toPlanView(toPlanView(plan()))), Object.keys(toPlanView(plan())));
});

test("багц: өөр файлыг төлөвлөгөө гэж нээхгүй", async () => {
  const bad = /төлөвлөгөөний файл биш/;
  await assert.rejects(unpackPlan(await zipText("plan.json", JSON.stringify({ kind: "booroljuut-master-plan", version: 1, plans: [] }))), bad);
  await assert.rejects(unpackPlan(await zipText("plan.json", "тэмдэгт")), bad);
  await assert.rejects(unpackPlan(new Uint8Array([1, 2, 3])), bad);
});

test("багц: төлөвлөсөн замын огтлолыг хадгалж дахин нээхэд ижил өргөнтэй байна", async () => {
  const b = draft();
  const section = { walkW: 2, bikeW: 1.5, laneW: 3.5, artLanes: 1, colLanes: 1, serviceW: 0 };
  b.plan.inp = { ...section, pop: 500, mode: "grid" };
  const opened = await unpackPlan(await packPlan(b));
  assert.deepEqual(opened.plan.streetInputs, section);
  assert.equal("inp" in opened.plan, false);
  assert.deepEqual(toPlanView(opened.plan).streetInputs, section);
  assert.equal(toPlanView(plan()).streetInputs, undefined); // өмнөх хадгалсан загвар нийцтэй
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { NOT_COVERED, buildStandards, residentialFar } from "../lib/standards.ts";

const totals = { bcrRes: 0.3, farRes: 1.0, densNet: 300, greenPP: 8, kinderCover: 100, schoolCover: 100, transitCover: 100, parkSupply: 100, parkNeedRes: 100, parkCover: 100, water: 10, heatMw: 1 };
const input = (t = {}, o = {}) => ({
  plan: { t: { ...totals, ...t }, notes: [], ...o.plan }, inputs: { mode: "organic", floorsRes: 5, ...o.inputs },
  checks: o.checks ?? [{ label: "Налуу хэтэрсэн гудамжны хэсэг", value: "0", ok: true }],
});
const rows = (r) => buildStandards(r).mongolia[0].rows;
const find = (r, text) => rows(r).find((v) => v.text.includes(text));

test("Х.6.1: FAR нь давхраас хамаарна, 5 давхарт 0.8", () => {
  assert.equal(residentialFar(5), 0.8);
  assert.equal(residentialFar(6), 0.8);
  assert.equal(residentialFar(7), 1.2);
  assert.equal(find(input({ farRes: 1.0 }), "FAR").status, "gap");
  assert.equal(find(input({ farRes: 0.7 }), "FAR").status, "met");
  assert.equal(find(input({ farRes: 1.0 }, { inputs: { floorsRes: 9 } }), "FAR").status, "met");
});

test("гэр хороолол: BCR 0.2, FAR 0.4, олон давхрын мөрүүд гарахгүй", () => {
  const r = input({ bcrRes: 0.1, farRes: 0.1 }, { inputs: { mode: "ger" } });
  assert.ok(find(r, "BCR").text.includes("0.2"));
  assert.ok(find(r, "FAR").text.includes("0.4"));
  for (const t of ["450", "Цэцэрлэг", "авто зогсоол"]) assert.equal(find(r, t), undefined, t);
});

test("З.6.9 нягтрал: 4-өөс доош давхарт хамаарахгүй", () => {
  assert.equal(find(input({}, { inputs: { floorsRes: 3 } }), "450"), undefined);
  assert.equal(find(input({ densNet: 451 }), "450").status, "gap");
});

test("Х.8.2: хорооллын 6 м² хангасан ч хөдөөгийн 12 м²-т хэсэгчлэн", () => {
  const r = input({ greenPP: 8 });
  assert.equal(find(r, "Хорооллын").status, "met");
  assert.equal(find(r, "Хотын нийтийн").status, "partial");
  assert.equal(find(input({ greenPP: 12 }), "Хотын нийтийн").status, "met");
  assert.equal(find(input({ greenPP: 5 }), "Хорооллын").status, "gap");
});

test("радиус тооцоо нормтой таарахгүй тул 100% ч «хангасан» гэхгүй", () => {
  assert.equal(find(input({ kinderCover: 100 }), "Цэцэрлэг").status, "partial");
  assert.equal(find(input({ schoolCover: 100 }), "Сургууль").status, "partial");
});

test("ТХГН: хориг мөрдсөн; давхарга татагдаагүй бол зөрүүтэй", () => {
  assert.equal(find(input(), "хамгаалалттай").status, "enforced");
  const gap = input({}, { plan: { notes: ["Тусгай хамгаалалттай газар: давхарга татагдсангүй, ..."] } });
  assert.equal(find(gap, "хамгаалалттай").status, "gap");
});

test("төлөвлөгөөгүй бол ямар ч мөр хангасан гэж гарахгүй", () => {
  const { mongolia, international } = buildStandards(null);
  for (const d of [...mongolia, ...international]) for (const r of d.rows) assert.equal(r.status, "pending", r.text);
});

test("бүрэн хангаагүй жишгийг хангасан гэж бичихгүй", () => {
  const { mongolia, international } = buildStandards(input());
  assert.equal(international.find((d) => d.code.startsWith("EU")).rows[0].status, "gap");
  assert.equal(international.find((d) => d.code.startsWith("ADA")).rows[0].status, "partial");
  for (const code of ["БНбД 40-01-14", "БНбД 40-02-16", "БНбД 41-02-13"]) assert.equal(mongolia.find((d) => d.code === code).rows[0].status, "partial", code);
  assert.ok(NOT_COVERED.some((n) => n.code === "БНбД 21-01-02"));
});

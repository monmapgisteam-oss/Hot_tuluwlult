import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAdmin } from "../lib/server/vectors.ts";

test("loadAdmin: сум өөрийн төвтэй, ижил нэртэй сумыг аймгаар ялгана", async () => {
  const a = await loadAdmin("Төв", "Баянжаргалан");
  assert.ok(a.rings.length >= 1);
  assert.equal(a.anchor.name, "Баянжаргалан");
  const b = await loadAdmin("Дундговь", "Баянжаргалан");
  assert.notDeepEqual(a.anchor.lonLat, b.anchor.lonLat);
});

test("loadAdmin: аймаг кодоор холбогдоно, файл хооронд зөрдөг нэртэй ч олдоно", async () => {
  const a = await loadAdmin("Дархан-Уул"); // аймгийн файлд «Дархан Уул»
  assert.ok(a.rings.length >= 1);
  assert.equal(a.anchor.name, "Дархан");
  assert.equal((await loadAdmin("Архангай")).anchor.name, "Цэцэрлэг");
});

test("loadAdmin: байхгүй нэрэнд null", async () => {
  assert.equal(await loadAdmin("Байхгүй"), null);
  assert.equal(await loadAdmin("Төв", "Байхгүй"), null);
});

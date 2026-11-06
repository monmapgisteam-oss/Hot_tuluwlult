import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
      if (specifier.startsWith("@arcgis/core/") && !specifier.endsWith(".js")) return nextResolve(`${specifier}.js`, context);
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { connectUrbanStreets, trimLocalStreets } = await import("../lib/plan/urbanStreetConnections.ts");
const { area, bufPath, diff, pathLength, setPlanWkid } = await import("../lib/plan/geom.ts");
hook.deregister();
setPlanWkid(32648);

const X = 500000, Y = 5200000;
const pt = (x, y) => [X + x, Y + y];
const site = [[pt(0, 0), pt(0, 1000), pt(1000, 1000), pt(1000, 0), pt(0, 0)]];
const street = (id, cls, path, w = 18) => ({ id, cls, path: path.map(([x, y]) => pt(x, y)), w });
const outside = (s) => area(diff(bufPath([s.path], s.w / 2), site));

test("хилээс гарсан орон нутгийн гудамжийн багтах хэсэг үлдэнэ, өргөн нь хилээс гарахгүй", () => {
  const [s, ...rest] = trimLocalStreets([street(1, "local", [[500, 500], [1100, 500]])], site);
  assert.equal(rest.length, 0);
  assert.equal(s.id, 1);
  assert.ok(outside(s) <= 0.01, `хилээс ${outside(s)} м² гарсан`);
  assert.ok(pathLength(s.path) > 470 && pathLength(s.path) < 491, `урт ${pathLength(s.path)}`);
});

test("хилийн дагуух гудамж ирмэгээс бага зэрэг гарсан ч бүтнээрээ алдагдахгүй", () => {
  const trimmed = trimLocalStreets([street(1, "local", [[5, 100], [5, 900], [500, 900]])], site);
  assert.ok(trimmed.length >= 1);
  for (const s of trimmed) assert.ok(outside(s) <= 0.01);
  assert.ok(trimmed.reduce((sum, s) => sum + pathLength(s.path), 0) >= 450);
});

test("багтаж байгаа гудамж, гол зам, гадна холболт өөрчлөгдөхгүй", () => {
  const inside = street(1, "local", [[100, 100], [900, 100]]);
  const arterial = street(2, "arterial", [[500, 500], [1100, 500]], 30);
  const external = { ...street(3, "local", [[500, 500], [1500, 500]]), ext: true };
  assert.deepEqual(trimLocalStreets([inside, arterial, external], site), [inside, arterial, external]);
});

test("хил дотор дөнгөж үлдэх богино хэсгийг гудамж болгохгүй", () => {
  assert.deepEqual(trimLocalStreets([street(1, "local", [[985, 500], [1200, 500]])], site), []);
});

test("хилээр хоёр хуваагдсан гудамжид давхардаагүй дугаар олгоно", () => {
  // Хүрэз хэлбэрийн талбай: гудамж завсрын зайг дайран өнгөрнө
  const notch = [[pt(0, 0), pt(0, 1000), pt(400, 1000), pt(400, 300), pt(600, 300), pt(600, 1000), pt(1000, 1000), pt(1000, 0), pt(0, 0)]];
  const parts = trimLocalStreets([street(7, "local", [[100, 600], [900, 600]])], notch);
  assert.equal(parts.length, 2);
  assert.equal(new Set(parts.map((s) => s.id)).size, 2);
  assert.ok(parts.some((s) => s.id === 7));
});

test("connectUrbanStreets: хилийг давсан салаа тайрагдаж сүлжээнд үлдэнэ", () => {
  const out = connectUrbanStreets([
    street(1, "arterial", [[100, 500], [900, 500]], 30),
    street(2, "local", [[500, 500], [500, 1100]]),
  ], site, null, 18);
  const branch = out.find((s) => s.id === 2);
  assert.ok(branch, "хилийг давсан салаа бүтнээрээ хасагдсан");
  assert.ok(outside(branch) <= 0.01);
  assert.ok(pathLength(branch.path) > 450);
});

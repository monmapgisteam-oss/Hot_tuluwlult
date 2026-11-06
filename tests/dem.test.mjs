import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Planning modules use bundler-style imports. Resolve their actual sources for Node tests.
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
const { loadDem } = await import("../lib/plan/dem.ts");
hook.deregister();

test("loadDem rejects incomplete or oversized successful responses before planning", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  // The requested grid has 11 × 11 Float32 elevations = 484 bytes.
  for (const byteLength of [0, 480, 483, 488]) {
    globalThis.fetch = async () => new Response(new ArrayBuffer(byteLength));
    await assert.rejects(loadDem({ x0: byteLength * 100, y0: 0, x1: byteLength * 100 + 100, y1: 100 }, 10), /DEM өгөгдлийн хэмжээ буруу/);
  }
});

test("loadDem retries after a failed response and caches a complete grid", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let requests = 0;
  const values = Float32Array.from({ length: 121 }, (_, i) => 1400 + i * 0.25);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/dem");
    assert.equal(init.method, "POST");
    const request = JSON.parse(init.body);
    assert.deepEqual([request.nx, request.ny, request.cell, request.wkid], [11, 11, 10, 32648]);
    requests++;
    return new Response(requests === 1 ? new ArrayBuffer(0) : values.buffer);
  };
  const bounds = { x0: 500000, y0: 5200000, x1: 500100, y1: 5200100 };
  await assert.rejects(loadDem(bounds, 10), /DEM өгөгдлийн хэмжээ буруу/);
  const result = await loadDem(bounds, 10);
  assert.equal(result.z.length, result.nx * result.ny);
  assert.deepEqual([...result.z], [...values]);
  assert.strictEqual(await loadDem(bounds, 10), result);
  assert.equal(requests, 2);
});

test("loadDem still rejects a full-sized grid containing missing elevations", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const values = new Float32Array(121).fill(1400);
  values[60] = NaN;
  globalThis.fetch = async () => new Response(values.buffer);
  await assert.rejects(loadDem({ x0: 600000, y0: 5200000, x1: 600100, y1: 5200100 }, 10), /DEM өндөр дутуу: 1\/121/);
});

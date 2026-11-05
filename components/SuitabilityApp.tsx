"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import proj4 from "proj4";
import MapPane, { type MapHandle } from "./MapPane";
import Panel from "./Panel";
import type { PlanState } from "./PlanPanel";
import type { PlanInputs } from "@/lib/plan/runSettlement";
import type { PlanDim, PlanLayerKey } from "@/lib/plan/planLayers";
import type { SessionUser } from "./LoginScreen";
import {
  EXCLUSIONS, FACTORS, GROUP_DEFAULT, effective, evaluate,
  type Prepared,
} from "@/lib/suit.ts";

const ALL_LEVELS = [1, 2, 3, 4, 5];
// Шалгуурын жин, хориг, ангиллын арга тогтмол; хэрэглэгч өөрчлөхгүй
const EFFECTIVE = effective(FACTORS, GROUP_DEFAULT);
const RESULT_OPACITY = 0.75;
const PLAN_INITIAL: PlanInputs = { pop: 10000, floorsRes: 5, mode: "organic", maxSlope: 10, water: 200, heatWm2: 60, elecKwHh: 3, siteHa: "", riverM: 500 };
const LAYERS_INITIAL: Record<PlanLayerKey, boolean> = { site: true, ground: true, streets: true, buildings: true, trees: true, zones: false, water: false, sewer: false, heat: false, power: false, storm: false };
const PLAN_EMPTY: PlanState = { busy: false, step: null, err: null, result: null };
export type Region = { aimag: string; soum: string | null };
type Target = { rings: [number, number][][] } | { admin: Region };
/** Сум, аймгийн төвийг тойрсон төлөвлөлтийн хүрээ: 314 км² */
const CENTER_RADIUS_M = 10000;

function centerArea(p: Prepared): [number, number][][] {
  const tr = proj4(`+proj=utm +zone=${p.utmZone}${p.epsg >= 32700 ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (((i % 48) / 48) * Math.PI * 2);
    return tr.inverse([p.anchor!.x + Math.cos(a) * CENTER_RADIUS_M, p.anchor!.y + Math.sin(a) * CENTER_RADIUS_M]) as [number, number];
  });
  return [ring];
}

/** JSON-д NaN нь null болдог — буцааж NaN болгоно */
function decode(p: Prepared): Prepared {
  const num = Object.fromEntries(Object.entries(p.num).map(([k, v]) => [k, Float64Array.from(v as number[], (a) => a ?? NaN)]));
  return { ...p, num };
}

export default function SuitabilityApp({ user, onSignOut, onExpired }: { user: SessionUser; onSignOut: () => void; onExpired: () => void }) {
  const mapRef = useRef<MapHandle>(null);
  const abort = useRef<AbortController | null>(null);
  const [rings, setRings] = useState<[number, number][][] | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);

  const [levels, setLevels] = useState<number[]>(ALL_LEVELS);
  const [showResult, setShowResult] = useState(false);
  const [planInputs, setPlanInputs] = useState<PlanInputs>(PLAN_INITIAL);
  const [plan, setPlan] = useState<PlanState>(PLAN_EMPTY);
  const [planLayers, setPlanLayers] = useState(LAYERS_INITIAL);
  const [dim, setDim] = useState<PlanDim>("2d");
  const [region, setRegion] = useState<Region | null>(null);
  const planWorker = useRef<Worker | null>(null);
  const planSeq = useRef(0);
  const showRef = useRef(showResult);
  showRef.current = showResult;
  const stopPlan = () => { planSeq.current++; planWorker.current?.terminate(); planWorker.current = null; setPlan(PLAN_EMPTY); };

  const res = useMemo(() => (prep ? evaluate(prep, EFFECTIVE, EXCLUSIONS, "fixed") : null), [prep]);

  // Хүсэлтийн урсгалыг уншина. Нэвтрэлт дууссан бол null.
  const fetchPrepare = useCallback(async (body: Target, signal: AbortSignal | undefined, onStep: (s: string) => void): Promise<Prepared | null> => {
    const resp = await fetch("/api/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify(body) });
    if (resp.status === 401) { onExpired(); return null; }
    if (!resp.ok) {
      const d = await resp.json().catch(() => null);
      throw new Error(d?.error ?? `Сервер алдаа буцаалаа (${resp.status}).`);
    }
    const reader = resp.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", out: Prepared | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.type === "step") onStep(m.text);
        else if (m.type === "error") throw new Error(m.message);
        else if (m.type === "result") out = decode(m.data);
      }
    }
    if (!out) throw new Error("Серверийн хариу дутуу ирлээ.");
    return out;
  }, [onExpired]);

  const analyze = useCallback(async (target: Target) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    stopPlan();
    setBusy(true); setErr(null); setPrep(null); setStep("Шинжилгээ эхэлж байна…"); setLevels(ALL_LEVELS);
    try {
      const p = await fetchPrepare(target, ac.signal, setStep);
      if (p && abort.current === ac) setPrep(p);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      if (abort.current === ac) { setBusy(false); setStep(null); }
    }
  }, [fetchPrepare]);

  useEffect(() => () => { abort.current?.abort(); planWorker.current?.terminate(); }, []);

  const onPolygon = useCallback((r: [number, number][][] | null) => {
    setRings(r);
    if (r) { if (showRef.current) void analyze({ rings: r }); else { stopPlan(); abort.current?.abort(); setBusy(false); setStep(null); setPrep(null); setErr(null); } }
    else { setShowResult(false); stopPlan(); abort.current?.abort(); setBusy(false); setStep(null); setPrep(null); setErr(null); }
  }, [analyze]);

  const runPlan = async () => {
    if (!prep) return;
    planWorker.current?.terminate();
    const id = ++planSeq.current;
    const live = () => planSeq.current === id;
    setPlan({ busy: true, step: "Төлөвлөгчийг ачаалж байна…", err: null, result: null });
    let area = rings, base = prep;
    if (!area) {
      // Сум, аймаг сонгосон бол бүтэн нутаг биш: төвийн орчимд, зөвхөн тохиромжтой хэсэгт төлөвлөнө
      if (!prep.anchor) { setPlan({ busy: false, step: null, err: "Сум, аймгийн төв олдсонгүй. Полигон зурна уу.", result: null }); return; }
      area = centerArea(prep);
      try {
        const p = await fetchPrepare({ rings: area }, undefined, (s) => { if (live()) setPlan((v) => ({ ...v, step: s })); });
        if (!live()) return;
        if (!p) return;
        base = p;
      } catch (e) {
        if (live()) setPlan({ busy: false, step: null, err: (e as Error).message, result: null });
        return;
      }
    }
    const inputRings = area, inputPrep = base;
    const w = new Worker(new URL("../lib/plan/plan.worker.ts", import.meta.url), { type: "module", name: "settlement-plan" });
    planWorker.current = w;
    const finish = (next: PlanState) => { w.terminate(); if (planWorker.current === w) planWorker.current = null; setPlan(next); };
    const fail = (message: string) => finish({ busy: false, step: null, err: message, result: null });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "step") setPlan((v) => ({ ...v, step: m.text }));
      else if (m.type === "error") { if (/Нэвтрэх шаардлагатай/.test(m.message)) onExpired(); else fail(m.message); }
      else if (m.type === "done") {
        finish({ busy: false, step: null, err: null, result: { plan: m.plan, checks: m.checks } });
        setShowResult(false); // төлөвлөгөө тод харагдахын тулд тохиромжийн давхаргыг унтраана; чекээр дахин асаана
        setDim("3d");
      }
    };
    w.onerror = (e) => fail(e.message || "Төлөвлөгч ачаалагдсангүй.");
    w.onmessageerror = () => fail("Төлөвлөгөөний өгөгдлийг дамжуулж чадсангүй.");
    w.postMessage({ rings: inputRings, prep: inputPrep, inputs: planInputs });
  };

  // 1-р алхам: полигон бэлэн бол чек асаахад үнэлгээ эхэлнэ; унтраахад давхарга л нуугдана
  const changeShowResult = (on: boolean) => {
    setShowResult(on);
    if (!on || prep || busy) return;
    if (rings) void analyze({ rings });
    else if (region) void analyze({ admin: region });
  };
  // Шинэ аймаг, сум сонгоход зурсан полигон, үр дүн цэвэрлэгдэж чек унтарна
  const changeRegion = (r: Region | null, bbox: [number, number, number, number] | null) => {
    mapRef.current?.clearDraw();
    setRegion(r);
    if (bbox) mapRef.current?.zoomTo(bbox);
  };

  return (
    <div className="app">
      <Panel
        user={user} onSignOut={onSignOut}
        showResult={showResult} onShowResult={changeShowResult}
        planInputs={planInputs} onPlanInputs={setPlanInputs} plan={plan} onRunPlan={() => void runPlan()} planLayers={planLayers} onPlanLayers={setPlanLayers}
        drawing={drawing} busy={busy} step={step} err={err} prep={prep} res={res} hasPolygon={!!rings}
        eff={EFFECTIVE}
        levels={levels} onLevels={setLevels}
        onDraw={() => mapRef.current?.startDraw()}
        onClear={() => mapRef.current?.clearDraw()}
        region={region} onRegion={changeRegion}
      />
      <main className="stage">
        <MapPane ref={mapRef} prep={prep} res={res} levels={levels} opacity={RESULT_OPACITY} visible={showResult} plan={plan.result?.plan ?? null} planLayers={planLayers} dim={dim} onPolygon={onPolygon} onDrawing={setDrawing} />
        <div className="dimToggle" role="radiogroup" aria-label="Харагдац">
          {(["2d", "3d"] as const).map((d) => (
            <button key={d} role="radio" aria-checked={dim === d} className={dim === d ? "dimOn" : ""} onClick={() => setDim(d)}>{d.toUpperCase()}</button>
          ))}
        </div>
        {drawing && <div className="drawHint" role="status">Газрын зураг дээр дарж орой нэмнэ. Хоёр дарж дуусгана, Esc дарж цуцална.</div>}
      </main>
    </div>
  );
}

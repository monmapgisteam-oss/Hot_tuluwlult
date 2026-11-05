"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const planWorker = useRef<Worker | null>(null);
  const showRef = useRef(showResult);
  showRef.current = showResult;
  const stopPlan = () => { planWorker.current?.terminate(); planWorker.current = null; setPlan(PLAN_EMPTY); };

  const res = useMemo(() => (prep ? evaluate(prep, EFFECTIVE, EXCLUSIONS, "fixed") : null), [prep]);

  const analyze = useCallback(async (r: [number, number][][]) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    stopPlan();
    setBusy(true); setErr(null); setPrep(null); setStep("Шинжилгээ эхэлж байна…"); setLevels(ALL_LEVELS);
    try {
      const resp = await fetch("/api/prepare", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ rings: r }),
      });
      if (resp.status === 401) { onExpired(); return; }
      if (!resp.ok) {
        const d = await resp.json().catch(() => null);
        throw new Error(d?.error ?? `Сервер алдаа буцаалаа (${resp.status}).`);
      }
      const reader = resp.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "", got = false;
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
          if (m.type === "step") setStep(m.text);
          else if (m.type === "error") throw new Error(m.message);
          else if (m.type === "result") { setPrep(decode(m.data)); got = true; }
        }
      }
      if (!got) throw new Error("Серверийн хариу дутуу ирлээ.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      if (abort.current === ac) { setBusy(false); setStep(null); }
    }
  }, [onExpired]);

  useEffect(() => () => { abort.current?.abort(); planWorker.current?.terminate(); }, []);

  const onPolygon = useCallback((r: [number, number][][] | null) => {
    setRings(r);
    if (r) { if (showRef.current) void analyze(r); else { stopPlan(); abort.current?.abort(); setBusy(false); setStep(null); setPrep(null); setErr(null); } }
    else { setShowResult(false); stopPlan(); abort.current?.abort(); setBusy(false); setStep(null); setPrep(null); setErr(null); }
  }, [analyze]);

  const runPlan = () => {
    if (!prep || !rings) return;
    planWorker.current?.terminate();
    setPlan({ busy: true, step: "Төлөвлөгчийг ачаалж байна…", err: null, result: null });
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
    w.postMessage({ rings, prep, inputs: planInputs });
  };

  // 1-р алхам: полигон бэлэн бол чек асаахад үнэлгээ эхэлнэ; унтраахад давхарга л нуугдана
  const changeShowResult = (on: boolean) => {
    setShowResult(on);
    if (on && rings && !prep && !busy) void analyze(rings);
  };

  return (
    <div className="app">
      <Panel
        user={user} onSignOut={onSignOut}
        showResult={showResult} onShowResult={changeShowResult}
        planInputs={planInputs} onPlanInputs={setPlanInputs} plan={plan} onRunPlan={runPlan} planLayers={planLayers} onPlanLayers={setPlanLayers}
        drawing={drawing} busy={busy} step={step} err={err} prep={prep} res={res} hasPolygon={!!rings}
        eff={EFFECTIVE}
        levels={levels} onLevels={setLevels}
        onDraw={() => mapRef.current?.startDraw()}
        onClear={() => mapRef.current?.clearDraw()}
        onZoom={(b) => mapRef.current?.zoomTo(b)}
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

"use client";
// «Төлөвлөлт» таб: зурсан полигон дээр суурьшил төлөвлөж барилга, зам, инженерийн шугамыг гаргана.
import { fmtN } from "@/lib/suit.ts";
import type { PlanInputs } from "@/lib/plan/runSettlement";
import type { Check, Plan } from "@/lib/plan/urban";
import type { PlanLayerKey } from "@/lib/plan/planLayers";

export type PlanResult = { plan: Plan; checks: Check[] };
export type PlanState = { busy: boolean; step: string | null; err: string | null; result: PlanResult | null };

/** planLayers.ts-ийн PLAN_LAYERS-тэй ижил — тэр модуль ArcGIS-ийг татдаг тул энд хуулав */
export const PLAN_TOGGLES: { key: PlanLayerKey; label: string; color: string }[] = [
  { key: "buildings", label: "Барилга", color: "#c9a77e" },
  { key: "streets", label: "Зам, гудамж", color: "#53585a" },
  { key: "ground", label: "Гадаргуу, ногоон байгууламж", color: "#929a73" },
  { key: "trees", label: "Мод, гэрэл", color: "#3f6b3a" },
  { key: "site", label: "Төлөвлөх талбайн хил", color: "#f97316" },
  { key: "zones", label: "Бүсчлэл", color: "#7aa874" },
  { key: "water", label: "Ус хангамж", color: "#2F80ED" },
  { key: "sewer", label: "Бохир ус", color: "#8B5A2B" },
  { key: "heat", label: "Дулаан", color: "#E03E2D" },
  { key: "power", label: "Цахилгаан", color: "#F2B705" },
  { key: "storm", label: "Борооны ус", color: "#17BEBB" },
];

function Num({ label, unit, value, onChange, placeholder }: { label: string; unit?: string; value: number | ""; onChange: (v: number | "") => void; placeholder?: string }) {
  return (
    <label className="numIn">
      <span>{label}</span>
      <div className="numBox">
        <input type="number" min={0} value={value} placeholder={placeholder ?? "—"} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
        {unit && <em>{unit}</em>}
      </div>
    </label>
  );
}

export default function PlanPanel({ hasPrep, inputs, onInputs, state, layers, onLayers }: {
  hasPrep: boolean; inputs: PlanInputs; onInputs: (i: PlanInputs) => void; state: PlanState;
  layers: Record<PlanLayerKey, boolean>; onLayers: (l: Record<PlanLayerKey, boolean>) => void;
}) {
  const set = (patch: Partial<PlanInputs>) => onInputs({ ...inputs, ...patch });
  const { busy, step, err, result } = state;
  const valid = Number(inputs.pop) > 0 && Number(inputs.floorsRes) > 0 && Number(inputs.maxSlope) > 0;
  const pl = result?.plan;
  const netKm = (s: "water" | "sewer" | "heat" | "power" | "storm") => (pl?.nets[s]?.lines ?? []).reduce((a, l) => a + l.path.reduce((b, p, i) => b + (i ? Math.hypot(p[0] - l.path[i - 1][0], p[1] - l.path[i - 1][1]) : 0), 0), 0) / 1000;
  const streetKm = pl ? pl.streets.filter((s) => !s.ext).reduce((a, s) => a + s.path.reduce((b, p, i) => b + (i ? Math.hypot(p[0] - s.path[i - 1][0], p[1] - s.path[i - 1][1]) : 0), 0), 0) / 1000 : 0;
  const warnings = pl ? [...new Set(Object.values(pl.nets).flatMap((n) => n?.warnings ?? []))] : [];
  const failed = result?.checks.filter((c) => c.ok === false) ?? [];

  return (
    <div className="plan">
      <section>
        <h3>Төлөвлөлтийн тохиргоо</h3>
        <p className="sectionHint">Зөвхөн тохиромжтой хэсэгт төлөвлөнө. Полигон зураагүй бол сум, аймгийн төвөөс 10 км-ийн хүрээнд.</p>
        <div className="form">
          <Num label="Хүн ам" unit="хүн" value={inputs.pop} onChange={(v) => set({ pop: Number(v) })} />
          <Num label="Орон сууцны давхар" unit="давхар" value={inputs.floorsRes} onChange={(v) => set({ floorsRes: Number(v) })} />
          <Num label="Тогтмол талбай" unit="га" value={inputs.siteHa} placeholder="хүн амаас" onChange={(v) => set({ siteHa: v })} />
          <label className="field">
            <span>Гудамжны хэлбэр</span>
            <select value={inputs.mode} onChange={(e) => set({ mode: e.target.value as PlanInputs["mode"] })}>
              <option value="organic">Гадаргад дагасан</option>
              <option value="grid">Тор</option>
              <option value="terrain">Гадаргын блокоор</option>
            </select>
          </label>
        </div>
        <details className="planAdvanced">
          <summary>Нарийвчилсан тохиргоо<span>5 үзүүлэлт</span></summary>
          <fieldset className="planFieldset">
            <legend>Байршлын хязгаарлалт</legend>
            <div className="form">
              <Num label="Хамгийн их налуу" unit="%" value={inputs.maxSlope} onChange={(v) => set({ maxSlope: Number(v) })} />
              <Num label="Голоос хол" unit="м" value={inputs.riverM} onChange={(v) => set({ riverM: Number(v) })} />
            </div>
          </fieldset>
          <fieldset className="planFieldset">
            <legend>Инженерийн хэрэглээ</legend>
            <div className="form">
              <Num label="Ус" unit="л/хүн/хон" value={inputs.water} onChange={(v) => set({ water: Number(v) })} />
              <Num label="Дулаан" unit="Вт/м²" value={inputs.heatWm2} onChange={(v) => set({ heatWm2: v })} />
              <Num label="Цахилгаан" unit="кВт/өрх" value={inputs.elecKwHh} onChange={(v) => set({ elecKwHh: v })} />
            </div>
          </fieldset>
        </details>
        {!hasPrep && !busy && <p className="muted">Эхлээд «Тохиромжтой байдлын үнэлгээ»-г асаана уу.</p>}
        {!valid && <p className="error inlineError" role="alert">Хүн ам, давхар, налуу 0-ээс их байх ёстой.</p>}
      </section>

      {busy && (
        <div className="progress" role="status" aria-live="polite">
          <p><span className="spinner" />{step}</p>
          <u className="progressBar"><s /></u>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}

      {pl && result && (
        <>
          {!!pl.notes?.length && <div className="notes">{pl.notes.map((n) => <p className="info" key={n}>{n}</p>)}</div>}
          <dl className="kpis">
            <div><dt>Хүн ам</dt><dd>{fmtN(pl.t.pop)} <small>{fmtN(pl.t.hh)} өрх</small></dd></div>
            <div><dt>Төлөвлөх талбай</dt><dd>{fmtN(pl.siteArea / 1e4, 1)} <small>га</small></dd></div>
            <div><dt>Барилга</dt><dd>{fmtN(pl.bldgs.length)} <small>{fmtN(pl.t.gfa / 1e4, 1)} га талбай</small></dd></div>
            <div><dt>Нягтшил</dt><dd>{fmtN(pl.t.densGross)} <small>хүн/га</small></dd></div>
          </dl>

          <section>
            <h3>Давхарга</h3>
            <div className="planLayers">
              {PLAN_TOGGLES.map((l) => (
                <label className="switch" key={l.key}>
                  <span className="layerName"><i style={{ background: l.color }} />{l.label}</span>
                  <input type="checkbox" role="switch" checked={layers[l.key]} onChange={(e) => onLayers({ ...layers, [l.key]: e.target.checked })} />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3>Зам ба инженерийн шугам</h3>
            <div className="rows">
              <div className="row"><span>Зам, гудамж</span><em>{fmtN(streetKm, 1)} км</em></div>
              <div className="row"><span>Цэвэр ус</span><em>{fmtN(netKm("water"), 1)} км · {fmtN(pl.t.water)} м³/хон</em></div>
              <div className="row"><span>Бохир ус</span><em>{fmtN(netKm("sewer"), 1)} км · {fmtN(pl.t.sewer)} м³/хон</em></div>
              <div className="row"><span>Дулаан</span><em>{fmtN(netKm("heat"), 1)} км · {pl.t.heatMw == null ? "—" : `${fmtN(pl.t.heatMw, 1)} МВт`}</em></div>
              <div className="row"><span>Цахилгаан</span><em>{fmtN(netKm("power"), 1)} км · {pl.t.elecMw == null ? "—" : `${fmtN(pl.t.elecMw, 1)} МВт`}</em></div>
              <div className="row"><span>Борооны ус</span><em>{fmtN(netKm("storm"), 1)} км</em></div>
            </div>
          </section>

          <section>
            <h3>Нормын шалгалт <em>{failed.length ? `${failed.length} зөрүүтэй` : "зөрүүгүй"}</em></h3>
            <div className="checks">
              {result.checks.map((c) => (
                <div className="check" key={c.label} title={`Норм: ${c.norm} · ${c.src}`}>
                  <i className={c.ok === true ? "ok" : c.ok === false ? "bad" : "info"} aria-label={c.ok === true ? "Хангасан" : c.ok === false ? "Хангаагүй" : "Мэдээлэл"} />
                  <span>{c.label}</span>
                  <b>{c.value}</b>
                </div>
              ))}
            </div>
            <p className="muted spaced">Мөр дээр хулгана аваачихад норм, эх сурвалж гарна. Норм, оноог БНбД-ээр ШАЛГАХ.</p>
          </section>

          {warnings.length > 0 && (
            <section>
              <h3>Анхааруулга</h3>
              <div className="notesPlain">{warnings.map((w) => <p className="muted" key={w}>{w}</p>)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

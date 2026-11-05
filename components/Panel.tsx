"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import PlanPanel, { type PlanState } from "./PlanPanel";
import type { PlanInputs } from "@/lib/plan/runSettlement";
import type { PlanLayerKey } from "@/lib/plan/planLayers";
import {
  LEVELS, fmtN, verdictOf,
  type Factor, type Prepared, type SourceStatus, type Summary,
} from "@/lib/suit.ts";

type BBox = [number, number, number, number];
type SoumEntry = { aimag: string; soum: string; bbox: BBox };
type Tab = "result" | "plan";

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "result", label: "Тохиромж", icon: "chart" },
  { key: "plan", label: "Төлөвлөлт", icon: "plan" },
];
/** Түвшний өнгөн дээрх текстийн өнгө — улаан, бараан ногоон дээр цагаан */
const onLevel = (n: number) => (n === 1 || n === 5 ? "#ffffff" : "#1b2430");

const ICONS: Record<string, ReactNode> = {
  polygon: <path d="M5 8.5 11 3l8 4 2 9-7 5-9-3zM5 8.5 5 18" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  pin: <><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  layers: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  logout: <path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H10" />,
  chart: <path d="M4 4v16h16M8 15v-4M13 15V7M18 15V9" />,
  plan: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M14 14h7v7h-7z" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
};
function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function useSoums() {
  const [soums, setSoums] = useState<SoumEntry[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/data/soum.geojson").then((r) => r.json()).then((g) => {
      if (!live) return;
      type F = { properties: { aimag_name: string; soum_name: string }; geometry: { coordinates: unknown } };
      setSoums((g.features as F[]).map((f) => {
        const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
        const walk = (c: unknown): void => {
          const a = c as number[] | unknown[];
          if (typeof a[0] === "number") {
            const [x, y] = a as number[];
            b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
          } else (a as unknown[]).forEach(walk);
        };
        walk(f.geometry.coordinates);
        return { aimag: f.properties.aimag_name, soum: f.properties.soum_name, bbox: b };
      }));
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return soums;
}

const union = (list: BBox[]): BBox => list.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity] as BBox);

function AdminSelect({ onZoom }: { onZoom: (b: BBox) => void }) {
  const soums = useSoums();
  const [aimag, setAimag] = useState("");
  const [soum, setSoum] = useState("");
  const aimags = useMemo(() => [...new Set(soums.map((s) => s.aimag))].sort((a, b) => a.localeCompare(b, "mn")), [soums]);
  const list = useMemo(() => soums.filter((s) => s.aimag === aimag).sort((a, b) => a.soum.localeCompare(b.soum, "mn")), [soums, aimag]);
  return (
    <div className="adminRow">
      <label className="field">
        <span>Аймаг</span>
        <select value={aimag} onChange={(e) => {
          setAimag(e.target.value);
          setSoum("");
          const sel = soums.filter((s) => s.aimag === e.target.value);
          if (sel.length) onZoom(union(sel.map((s) => s.bbox)));
        }}>
          <option value="">Бүх аймаг</option>
          {aimags.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Сум</span>
        <select disabled={!aimag} value={soum} onChange={(e) => {
          setSoum(e.target.value);
          const s = list.find((v) => v.soum === e.target.value);
          if (s) onZoom(s.bbox);
        }}>
          <option value="">{aimag ? `Сонгох (${list.length})` : "Аймаг сонгоно уу"}</option>
          {list.map((s) => <option key={s.soum} value={s.soum}>{s.soum}</option>)}
        </select>
      </label>
    </div>
  );
}

function Stack({ areas }: { areas: number[] }) {
  const t = areas.reduce((s, v) => s + v, 0) || 1;
  return (
    <div className="stack" role="img" aria-label={LEVELS.map((l) => `${l.label} ${fmtN((areas[l.n - 1] / t) * 100)}%`).join(", ")}>
      {[...LEVELS].reverse().map((l) => areas[l.n - 1] > 0 && (
        <i key={l.n} style={{ flexGrow: areas[l.n - 1] / t, background: l.color }} title={`${l.label}: ${fmtN(areas[l.n - 1], 1)} га`} />
      ))}
    </div>
  );
}

function Levels({ res, levels, onLevels }: { res: Summary; levels: number[]; onLevels: (l: number[]) => void }) {
  const total = res.areas.reduce((s, v) => s + v, 0) || 1;
  const toggle = (n: number) => onLevels(levels.includes(n) ? levels.filter((x) => x !== n) : [...levels, n].sort());
  return (
    <div className="levels">
      {[...LEVELS].reverse().map((l) => {
        const v = res.areas[l.n - 1], share = (v / total) * 100, on = levels.includes(l.n);
        return (
          <button key={l.n} className={`lv ${on ? "" : "lvOff"}`} onClick={() => toggle(l.n)} aria-pressed={on} title={on ? "Газрын зураг дээр нуух" : "Газрын зураг дээр харуулах"}>
            <i className="lvChip" style={{ background: on ? l.color : "transparent", borderColor: on ? l.color : undefined, color: onLevel(l.n) }}>{on && <Icon name="check" size={11} />}</i>
            <span className="lvName">{l.label}</span>
            <b>{fmtN(v, v < 10 ? 1 : 0)} га</b>
            <em>{fmtN(share, share < 10 ? 1 : 0)}%</em>
            <u className="lvBar"><s style={{ width: `${share}%`, background: l.color }} /></u>
          </button>
        );
      })}
    </div>
  );
}

/** Онооны тархалт: баганын өнгө нь тухайн онооны түвшин, тасархай шугам нь босго */
function ScoreHist({ res }: { res: Summary }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...res.hist.area, 1e-9);
  const W = 340, H = 84, n = res.hist.area.length, bw = W / n;
  const color = (s: number) => LEVELS[res.breaks.filter((b) => s >= b).length].color;
  return (
    <div className="hist">
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="Онооны тархалт" onMouseLeave={() => setHover(null)}>
        {res.hist.area.map((v, i) => {
          const h = v > 0 ? Math.max(1.5, (v / max) * H) : 0;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {h > 0 && <rect x={i * bw + 0.5} y={H - h} width={Math.max(1, bw - 1.5)} height={h} rx={1} fill={color((i + 0.5) * res.hist.step)} opacity={hover == null || hover === i ? 1 : 0.55} />}
            </g>
          );
        })}
        {res.breaks.map((b) => <line key={b} x1={b * W} x2={b * W} y1={0} y2={H} className="histBreak" />)}
        <line x1={0} x2={W} y1={H} y2={H} className="histAxis" />
        {[0, 25, 50, 75, 100].map((t) => <text key={t} x={(t / 100) * W} y={H + 13} className="histTick" textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"}>{t}</text>)}
      </svg>
      {hover != null && (
        <div className="histTip" style={{ left: `${Math.min(62, ((hover + 0.5) / n) * 100)}%` }}>
          Оноо {hover * 2}–{hover * 2 + 2}: <b>{fmtN(res.hist.area[hover], 1)} га</b>
        </div>
      )}
    </div>
  );
}

/** Жин × (100 − дундаж оноо): шалгуур нийт онооноос хэдэн оноо хасаж буй */
function LossBars({ res, eff }: { res: Summary; eff: Factor[] }) {
  const items = eff.filter((f) => f.weight > 0 && res.factorMean[f.key] != null).map((f) => ({
    f, v: f.weight * res.factorCover[f.key] * (1 - res.factorMean[f.key]!) * 100,
  }));
  const W = items.reduce((s, x) => s + x.f.weight * res.factorCover[x.f.key], 0) || 1;
  const rows = items.map((x) => ({ ...x, v: x.v / W })).filter((x) => x.v >= 0.1).sort((a, b) => b.v - a.v).slice(0, 6);
  const max = Math.max(...rows.map((r) => r.v), 1e-9);
  if (!rows.length) return <p className="muted">Бүх шалгуураар бүрэн оноотой.</p>;
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar" key={r.f.key}>
          <span>{r.f.label}</span>
          <b>−{fmtN(r.v, 1)}</b>
          <em><u style={{ width: `${(r.v / max) * 100}%` }} /></em>
        </div>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<SourceStatus["status"], string> = { loaded: "Бэлэн", partial: "Хэсэгчлэн", missing: "Мэдээлэлгүй" };

/** Шалгуур бүр хаанаас ирж, хэр хамарсан бэ — мэдээлэлгүйг нуухгүй */
function Sources({ prep, res, eff }: { prep: Prepared; res: Summary; eff: Factor[] }) {
  const rows = eff.filter((f) => f.weight > 0);
  const G = rows.reduce((s, f) => s + f.weight, 0) || 1;
  return (
    <div className="srcTable">
      <div className="srcRow srcHead"><span>Шалгуур</span><span>Жин</span><span>Оноо</span><span>Хамралт</span></div>
      {rows.map((f) => {
        const s = prep.sources[f.key];
        const cover = res.factorCover[f.key] ?? 0;
        const state = s?.status === "missing" || cover === 0 ? "missing" : s?.status === "partial" || cover < 0.98 ? "partial" : "loaded";
        const unscored = res.unscored[f.key];
        const detail = [s?.source, s?.note, unscored?.length ? `Онооны хүснэгтгүй ангилал: ${unscored.join("; ")}` : ""].filter(Boolean).join(" · ");
        return (
          <div className="srcRow" key={f.key} title={detail}>
            <span>{f.label}</span>
            <span>{fmtN((f.weight / G) * 100, 0)}%</span>
            <span>{res.factorMean[f.key] == null ? "—" : fmtN(res.factorMean[f.key]! * 100)}</span>
            <span className={`st st-${state}`}><i />{state === "partial" ? `${fmtN(cover * 100)}%` : STATUS_LABEL[state]}</span>
          </div>
        );
      })}
    </div>
  );
}

function Result({ prep, res, eff, levels, onLevels }: {
  prep: Prepared; res: Summary; eff: Factor[]; levels: number[]; onLevels: (l: number[]) => void;
}) {
  const verdict = verdictOf(res.areas);
  const usable = res.areas[3] + res.areas[4];
  const total = res.areas.reduce((s, v) => s + v, 0) || 1;
  const excluded = Object.entries(res.excluded).sort((a, b) => b[1] - a[1]);
  const zones = [...res.byZone].sort((a, b) => b.total - a.total);
  const main = zones[0];
  return (
    <div className="result">
      {verdict && (
        <section className="verdict" style={{ ["--lv" as string]: verdict.level.color }}>
          <div className="verdictTop">
            <div className="badge" style={{ background: verdict.level.color, color: onLevel(verdict.level.n) }}>{verdict.level.n}</div>
            <div className="verdictText">
              <span className="eyebrow">Нэгдсэн дүгнэлт</span>
              <h2>{verdict.level.label}</h2>
              <p>Дундаж түвшин <b>{fmtN(verdict.mean, 1)}</b> / 5</p>
            </div>
          </div>
          <Stack areas={res.areas} />
          {main && (
            <p className="place"><Icon name="pin" size={14} /><span><b>{main.z.soum}</b> сум, {main.z.aimag} аймаг{zones.length > 1 ? ` · бас ${zones.length - 1} сум` : ""}</span></p>
          )}
        </section>
      )}

      <dl className="kpis">
        <div><dt>Талбай</dt><dd>{fmtN(prep.areaHa, prep.areaHa < 100 ? 1 : 0)} <small>га</small></dd></div>
        <div><dt>Тохиромжтой (4–5)</dt><dd>{fmtN((usable / total) * 100)}% <small>{fmtN(usable, usable < 100 ? 1 : 0)} га</small></dd></div>
        <div><dt>Дундаж оноо</dt><dd>{fmtN(res.mean * 100)} <small>/ 100</small></dd></div>
        <div><dt>Мэдээллийн хамралт</dt><dd>{fmtN(res.coverage * 100)}%</dd><u className="meter"><s style={{ width: `${res.coverage * 100}%` }} /></u></div>
      </dl>

      {(res.coverage < 0.7 || prep.warnings.length > 0) && (
        <div className="notes">
          {res.coverage < 0.7 && <p className="warn">Шалгуурын жингийн {fmtN((1 - res.coverage) * 100)}%-д мэдээлэл алга. Үр дүнг зөвхөн байгаа шалгуураар тооцсон.</p>}
          {prep.warnings.map((w) => <p className="warn" key={w}>{w}</p>)}
        </div>
      )}

      <section>
        <h3>Түвшнээр <em>дарж газрын зураг дээр нуух</em></h3>
        <Levels res={res} levels={levels} onLevels={onLevels} />
        {levels.length < 5 && <button className="linkBtn" onClick={() => onLevels([1, 2, 3, 4, 5])}>Бүх түвшинг харуулах</button>}
      </section>

      {zones.length > 1 && (
        <section>
          <h3>Сумаар</h3>
          <div className="rows">
            {zones.slice(0, 6).map((z) => (
              <div key={`${z.z.aimag}-${z.z.soum}`} className="row">
                <span><b>{z.z.soum}</b> · {z.z.aimag}</span>
                <em>{fmtN(z.total, z.total < 100 ? 1 : 0)} га</em>
              </div>
            ))}
            {zones.length > 6 && <p className="muted">бас {zones.length - 6} сум</p>}
          </div>
        </section>
      )}
      {!zones.length && <section><h3>Байршил</h3><p className="muted">Монгол Улсын сумдын хилийн гадна.</p></section>}

      {excluded.length > 0 && (
        <section>
          <h3>Хоригт орсон талбай <em>1-р түвшинд тооцогдоно</em></h3>
          <div className="rows">
            {excluded.map(([k, v]) => <div className="row" key={k}><span>{k}</span><em>{fmtN(v, v < 100 ? 1 : 0)} га</em></div>)}
          </div>
        </section>
      )}

      <section>
        <h3>Оноог бууруулж буй шалгуур <em>оноо</em></h3>
        <LossBars res={res} eff={eff} />
      </section>

      <section>
        <h3>Онооны тархалт <em>га, тасархай нь босго</em></h3>
        <ScoreHist res={res} />
      </section>

      <section>
        <h3>Шалгуур ба өгөгдөл</h3>
        <Sources prep={prep} res={res} eff={eff} />
        <p className="muted">Мөр дээр хулгана аваачихад эх сурвалж, тайлбар гарна. Нүд {prep.cell} м, UTM {prep.utmZone}N. Нүд том байх тусам нарийн гуу жалга, огцом налуу нүдний дунджид уусна: нарийвчлах бол жижиг полигон зурна уу.</p>
      </section>
    </div>
  );
}

export default function Panel(props: {
  user: { username: string; fullName: string }; onSignOut: () => void;
  showResult: boolean; onShowResult: (v: boolean) => void;
  planInputs: PlanInputs; onPlanInputs: (i: PlanInputs) => void; plan: PlanState; onRunPlan: () => void;
  planLayers: Record<PlanLayerKey, boolean>; onPlanLayers: (l: Record<PlanLayerKey, boolean>) => void;
  drawing: boolean; busy: boolean; step: string | null; err: string | null; hasPolygon: boolean;
  prep: Prepared | null; res: Summary | null; eff: Factor[];
  levels: number[]; onLevels: (l: number[]) => void;
  onDraw: () => void; onClear: () => void; onZoom: (b: BBox) => void;
}) {
  const { drawing, busy, step, err, hasPolygon, prep, res, eff, levels } = props;
  const [tab, setTab] = useState<Tab>("result");
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const validPlan = Number(props.planInputs.pop) > 0 && Number(props.planInputs.floorsRes) > 0 && Number(props.planInputs.maxSlope) > 0;
  const canPlan = !!prep && !busy && !drawing && !props.plan.busy && validPlan;
  // Шинэ шинжилгээ эхлэхэд үр дүнгийн таб руу шилжинэ
  useEffect(() => { if (busy || drawing) setTab("result"); }, [busy, drawing]);


  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i + TABS.length - 1) % TABS.length : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].key);
    tabRefs.current[TABS[next].key]?.focus();
  };

  return (
    <aside className="panel" aria-label="Үнэлгээ ба төлөвлөлтийн удирдлага">
      <header className="brand">
        <span className="logo"><Icon name="layers" size={23} /></span>
        <div>
          <h1>ХОТ ТӨЛӨВЛӨЛТИЙН СИСТЕМ</h1>
          <p>Тохиромжтой байдлын үнэлгээ</p>
        </div>
        <button className="signOut" onClick={props.onSignOut} title={`${props.user.fullName} (${props.user.username}) · Гарах`} aria-label={`${props.user.fullName}: гарах`}>
          <span aria-hidden="true">{props.user.fullName.trim().charAt(0).toUpperCase() || "?"}</span><Icon name="logout" size={15} />
        </button>
      </header>

      <div className="panelScroll">
        <div className="control">
          <div className="controlHeading">
            <h2><Icon name="pin" size={16} />Судалгааны талбай</h2>
            <span className={`areaStatus ${hasPolygon ? "areaReady" : ""}`}>{drawing ? "Зурж байна" : hasPolygon ? "Сонгосон" : "Сонгоогүй"}</span>
          </div>
          <AdminSelect onZoom={props.onZoom} />

          <div className="actions">
            <button className={hasPolygon ? "outline" : "primary"} onClick={props.onDraw} disabled={drawing}>
              <Icon name="polygon" size={18} />{drawing ? "Зурж байна…" : hasPolygon ? "Шинэ полигон зурах" : "Полигон зурах"}
            </button>
            {(hasPolygon || drawing) && (
              <button className="ghost" onClick={props.onClear} aria-label="Полигоныг арилгах" title="Арилгах"><Icon name="close" /></button>
            )}
          </div>

          <p className="controlHint">{drawing ? "Орой бүр дээр дарж, хоёр дарж дуусгана. Esc — цуцлах." : "Аймаг, сум руу ойртуулж, газрын зураг дээр талбайгаа зурна уу."}</p>
        </div>

        <div className="tabs" role="tablist" aria-label="Цэс" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button key={t.key} ref={(el) => { tabRefs.current[t.key] = el; }} role="tab" id={`tab-${t.key}`} aria-selected={tab === t.key} aria-controls={`pane-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1} className={tab === t.key ? "tabOn" : ""} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={17} />{t.label}
              {(t.key === "result" ? !!res : !!props.plan.result) && <span className="tabComplete" aria-label="Үр дүн бэлэн"><Icon name="check" size={11} /></span>}
            </button>
          ))}
        </div>

        <div className="pane" role="tabpanel" id={`pane-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
          {tab === "result" && (
            <>
              <label className={`switch stepSwitch ${hasPolygon && !drawing ? "" : "stepOff"}`} title={drawing ? "Талбайгаа зурж дуусгана уу" : hasPolygon ? "" : "Эхлээд полигон зурна уу"}>
                <span className="switchCopy"><span id="assessment-label">Тохиромжтой байдлын үнэлгээ</span><small>{prep ? "Үр дүнгийн давхаргыг газрын зурагт харуулах" : "Асаахад сонгосон талбайг үнэлнэ"}</small></span>
                <input type="checkbox" role="switch" aria-labelledby="assessment-label" disabled={!hasPolygon || drawing} checked={props.showResult} onChange={(e) => props.onShowResult(e.target.checked)} />
              </label>
              {busy && (
                <div className="progress" role="status" aria-live="polite">
                  <p><span className="spinner" />{step}</p>
                  <u className="progressBar"><s /></u>
                </div>
              )}
              {err && <p className="error" role="alert">{err}</p>}
              {!busy && !err && !res && (
                <div className={`panelEmpty ${hasPolygon ? "emptyReady" : ""}`}>
                  <div className="emptyMap" aria-hidden="true">
                    <svg viewBox="0 0 180 112" fill="none">
                      <path d="m18 29 45-14 54 14 45-14v69l-45 14-54-14-45 14Z" fill="var(--surface)" stroke="var(--line-strong)" />
                      <path d="M63 15v69m54-55v69M18 51l45-13 54 14 45-14M18 76l45-14 54 14 45-14" stroke="var(--line)" />
                      <path d="m56 43 39-13 32 20-15 29-45-8Z" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />
                      {[[56, 43], [95, 30], [127, 50], [112, 79], [67, 71]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="3" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.5" />)}
                      <path d="M91 59s10-8 10-15a10 10 0 0 0-20 0c0 7 10 15 10 15Z" fill="var(--accent)" />
                      <circle cx="91" cy="44" r="3" fill="white" />
                    </svg>
                  </div>
                  <h2>{drawing ? "Талбайн хилээ зурна уу" : hasPolygon ? "Талбай үнэлэхэд бэлэн" : "Талбайгаа сонгоод эхлээрэй"}</h2>
                  <p>{drawing ? "Газрын зураг дээр полигоноо зурж дуусгахад дараагийн алхамд шилжинэ." : hasPolygon ? "Дээрх үнэлгээний товчлуурыг асаахад талбайн тохиромж, оноо, шалгуур энд харагдана." : "Сонгосон газрын тохиромжийг үнэлж, суурьшлын төлөвлөгөө гаргаарай."}</p>
                  <ol className="emptySteps" aria-label="Ашиглах дараалал">
                    <li className={hasPolygon ? "stepDone" : "stepCurrent"}><span>{hasPolygon ? <Icon name="check" size={12} /> : "1"}</span>Талбай зурах</li>
                    <li className={hasPolygon ? "stepCurrent" : ""}><span>2</span>Үнэлгээ асаах</li>
                    <li><span>3</span>Төлөвлөх</li>
                  </ol>
                </div>
              )}
              {prep && res && <Result prep={prep} res={res} eff={eff} levels={levels} onLevels={props.onLevels} />}
            </>
          )}

          {tab === "plan" && <PlanPanel hasPrep={!!prep && !busy} inputs={props.planInputs} onInputs={props.onPlanInputs} state={props.plan} layers={props.planLayers} onLayers={props.onPlanLayers} />}

        </div>
      </div>

      <footer className="panelFooter">
        <p id="plan-action-hint">{props.plan.busy ? "Төлөвлөгөө боловсруулж байна…" : drawing ? "Эхлээд талбайгаа зурж дуусгана уу" : busy ? "Талбайн үнэлгээг боловсруулж байна…" : !prep ? "Төлөвлөхийн өмнө талбайн үнэлгээг хийнэ үү" : !validPlan ? "Төлөвлөлтийн тохиргоогоо шалгана уу" : "Төлөвлөлтийн тохиргоогоо шалгаад эхлүүлээрэй"}</p>
        <button className="runPlan" disabled={!canPlan} aria-describedby="plan-action-hint" onClick={() => { setTab("plan"); props.onRunPlan(); }}>
          {props.plan.busy ? <span className="spinner" /> : <Icon name="plan" size={17} />}
          {props.plan.busy ? "Төлөвлөж байна…" : props.plan.result ? "Дахин төлөвлөх" : "Суурьшил төлөвлөх"}
          {!props.plan.busy && <Icon name="arrow" size={17} />}
        </button>
      </footer>
    </aside>
  );
}

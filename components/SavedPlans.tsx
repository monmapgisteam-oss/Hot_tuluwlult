"use client";
// «Хадгалсан загвар»: төлөвлөгөөг ArcGIS порталд хадгалах, өөрийн болон хуваалцсан загварыг нээх.
import { useCallback, useEffect, useState } from "react";
import { SessionExpired, listPlans, openPlan, savePlan, type PlanBundle, type PlanItem } from "@/lib/savedPlan.ts";

export type LinkedItem = { id: string; name: string; owner: string };
type Draft = Parameters<typeof savePlan>[0];

export default function SavedPlans({ username, draft, snippet, defaultName, linked, disabled, onOpen, onSaved, onExpired }: {
  username: string;
  /** Хадгалах төлөвлөгөө; байхгүй бол null */
  draft: ((name: string) => Draft) | null;
  snippet: string; defaultName: string;
  /** Нээлттэй төлөвлөгөөнд холбогдсон item */
  linked: LinkedItem | null;
  disabled: boolean;
  onOpen: (b: PlanBundle, item: PlanItem) => void;
  onSaved: (item: PlanItem) => void;
  onExpired: () => void;
}) {
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof SessionExpired) onExpired(); else setErr((e as Error).message);
  }, [onExpired]);

  useEffect(() => {
    let live = true;
    listPlans().then((v) => { if (live) setItems(v); }).catch((e) => { if (live) { setItems([]); fail(e); } });
    return () => { live = false; };
  }, [fail]);

  // Өөр төлөвлөгөө гарч ирэхэд нэрийг шинэчилнэ
  const hasDraft = !!draft;
  useEffect(() => { setName(linked?.name ?? (hasDraft ? defaultName : "")); }, [linked?.id, linked?.name, hasDraft, defaultName]);
  useEffect(() => { if (!hasDraft) setNote(null); }, [hasDraft]);

  // Нэр хэвээр, өөрийн item бол шинэчилнэ; бусад тохиолдолд шинэ item үүснэ
  const updating = !!linked && linked.owner === username && name.trim() === linked.name;

  const save = async () => {
    if (!draft || busy || !name.trim()) return;
    setBusy("save"); setErr(null); setNote(null);
    try {
      const { item, shared } = await savePlan(draft(name.trim()), snippet, updating ? linked!.id : null);
      setItems((v) => [item, ...(v ?? []).filter((x) => x.id !== item.id)]);
      onSaved(item);
      setNote(shared ? "Порталд хадгалагдлаа." : "Порталд хадгалагдлаа, гэхдээ бусдад хуваалцаж чадсангүй.");
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const open = async (item: PlanItem) => {
    if (busy) return;
    if (draft && !linked && !window.confirm("Хадгалаагүй төлөвлөгөө алга болно. Үргэлжлүүлэх үү?")) return;
    setBusy(item.id); setErr(null); setNote(null);
    try { onOpen(await openPlan(item.id), item); } catch (e) { fail(e); } finally { setBusy(null); }
  };

  return (
    <section className="savedPlans">
      <h3>Хадгалсан загвар <em>ArcGIS портал</em></h3>
      {draft && (
        <div className="savedForm">
          <input aria-label="Загварын нэр" placeholder="Загварын нэр" maxLength={120} value={name} disabled={disabled || !!busy} onChange={(e) => setName(e.target.value)} />
          <button className="outline" disabled={disabled || !!busy || !name.trim()} onClick={() => void save()}>
            {busy === "save" ? "Хадгалж байна…" : updating ? "Шинэчлэх" : "Хадгалах"}
          </button>
        </div>
      )}
      {note && <p className="muted spaced" role="status">{note}</p>}
      {err && <p className="error inlineError spaced" role="alert">{err}</p>}
      {items === null && <p className="muted">Ачаалж байна…</p>}
      {items?.length === 0 && !err && <p className="muted">Хадгалсан загвар алга.</p>}
      {!!items?.length && (
        <ul className="savedList">
          {items.map((i) => (
            <li key={i.id}>
              <div>
                <b>{i.title}</b>
                <small>{i.owner === username ? "" : `${i.owner} · `}{new Date(i.modified).toISOString().slice(0, 10)}{i.snippet ? ` · ${i.snippet}` : ""}</small>
              </div>
              <button className="linkBtn" disabled={disabled || !!busy || i.id === linked?.id} aria-label={`${i.title} загварыг нээх`} onClick={() => void open(i)}>
                {busy === i.id ? "Нээж байна…" : i.id === linked?.id ? "Нээлттэй" : "Нээх"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

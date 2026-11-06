"use client";
// «Стандарт» таб: мөрдөж буй норм, жишиг ба тухайн төлөвлөгөөний тулгалт.
import { STATUS_LABEL, buildStandards, type StdDoc, type StdInput } from "@/lib/standards.ts";

function Doc({ doc }: { doc: StdDoc }) {
  return (
    <section className="stdDoc">
      <h3>{doc.url ? <a href={doc.url} target="_blank" rel="noreferrer">{doc.code}</a> : doc.code}</h3>
      <p className="stdTitle">{doc.title}</p>
      {doc.note && doc.code !== "БНбД 30-01-24" && <p className="stdNote">{doc.note}</p>}
      <div className="stdRows">
        {doc.rows.map((r) => (
          <div className="stdRow" key={`${r.clause}-${r.text}`}>
            <div>
              <span>{r.clause !== "—" && <b>{r.clause} </b>}{r.text}</span>
              {r.value && <small>{r.value}</small>}
            </div>
            {r.status !== "pending" && <em className={`stdStatus std-${r.status}`}>{STATUS_LABEL[r.status]}</em>}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function StandardsPanel({ result }: { result: StdInput }) {
  const { mongolia, international } = buildStandards(result);
  return (
    <div className="plan standards">
      <p className="stdIntro">Төлөвлөгөөг дараах норм, жишигтэй автоматаар тулгана. Энэ нь концепт шатны тулгалт бөгөөд мэргэжлийн байгууллагын нийцлийн дүгнэлтийг орлохгүй.{!result && " Төлөвлөгөө гаргасны дараа заалт бүрийн үр дүн гарна."}</p>
      <h2 className="stdGroup">Монгол Улсын норм</h2>
      {mongolia.map((d) => <Doc doc={d} key={d.code} />)}
      <h2 className="stdGroup">Олон улсын жишиг <small>Монголд заавал биш</small></h2>
      {international.map((d) => <Doc doc={d} key={d.code} />)}
    </div>
  );
}

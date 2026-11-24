/**
 * Quadro de RDOs em quadradinhos (Atividades): cada coluna = dia (ou mês); a altura é o nº de clientes com equipe
 * escalada no mês e cada quadradinho preenchido é um cliente com RDO (escuro = finalizado, médio = rascunho).
 * Clicar numa coluna mostra o resumo ao lado.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";

export type TileCol = { key: string; label: string; title: string; max: number; fin: number; draft: number; expected: number; totalFin?: number; totalDraft?: number; totalExpected?: number };

const MAX_ROWS = 7;

export function RdoTiles({ cols, unit }: { cols: TileCol[]; unit: "day" | "month" }) {
  const [sel, setSel] = useState<number | null>(null);
  const top = Math.max(1, ...cols.map((c) => c.max));
  const per = Math.max(1, Math.ceil(top / MAX_ROWS)); // clientes por quadradinho
  const rows = Math.ceil(top / per);
  const i = sel ?? cols.length - 1;
  const c = cols[i];
  const fin = c ? (unit === "month" ? c.totalFin ?? 0 : c.fin) : 0;
  const draft = c ? (unit === "month" ? c.totalDraft ?? 0 : c.draft) : 0;
  const exp = c ? (unit === "month" ? c.totalExpected ?? 0 : c.expected) : 0;
  const pct = (v: number) => (exp ? `${((v / exp) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
  const step = cols.length > 16 ? 2 : 1;

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-end gap-[3px]">
          {cols.map((col, ci) => {
            const cap = Math.ceil(col.max / per);
            const f = Math.round(col.fin / per), dr = Math.min(cap - f, Math.round(col.draft / per));
            return (
              <button key={col.key} type="button" onClick={() => setSel(ci)} title={`${col.title}: ${col.fin + col.draft} de ${col.max} clientes`}
                className={cn("flex flex-1 flex-col items-stretch gap-[3px] rounded-md p-[2px] transition-colors", ci === i && "bg-muted ring-1 ring-border")}>
                {Array.from({ length: rows }, (_, r) => {
                  const fromBottom = rows - 1 - r;
                  const cls = fromBottom >= cap ? "bg-transparent"
                    : fromBottom < f ? "bg-foreground"
                    : fromBottom < f + dr ? "bg-foreground/45"
                    : "border border-dashed border-border bg-muted/40";
                  return <span key={r} className={cn("ov-grow w-full rounded-[4px]", unit === "month" ? "h-4" : "h-2", cls)} style={{ animationDelay: `${ci * 25 + fromBottom * 15}ms` }} />;
                })}
                <span className="mt-1 text-center text-[10px] tabular-nums text-muted-foreground">{ci % step === 0 || ci === i ? col.label : "\u00a0"}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">1 quadradinho = {per} {per === 1 ? "cliente" : "clientes"}{unit === "month" ? " (média por dia)" : ""}</p>
        <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
          <Legend cls="bg-foreground" label="Finalizado" />
          <Legend cls="bg-foreground/45" label="Rascunho" />
          <Legend cls="border border-dashed border-border bg-muted/40" label="Sem RDO (clientes ativos no mês)" />
        </div>
      </div>
      {c && (
        <div className="flex w-full flex-col rounded-xl border bg-muted/30 p-3 md:w-48 md:p-2.5">
          <p className="text-[11px] text-muted-foreground">{c.title}</p>
          <p className="font-display text-2xl font-semibold tabular-nums">{fin + draft}</p>
          <p className="text-[11px] text-muted-foreground">RDOs de {exp} esperados</p>
          <div className="mt-2 grid grid-cols-3 gap-1 text-xs md:grid-cols-1 md:space-y-0">
            <Row cls="bg-foreground" label="Finalizados" v={fin} pct={pct(fin)} />
            <Row cls="bg-foreground/45" label="Rascunho" v={draft} pct={pct(draft)} />
            <Row cls="border border-dashed border-border bg-muted/40" label="Sem RDO" v={Math.max(0, exp - fin - draft)} pct={pct(Math.max(0, exp - fin - draft))} />
          </div>
          <p className="mt-auto pt-3 text-[11px] text-muted-foreground">{c.max} clientes com equipe no mês</p>
        </div>
      )}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-[3px]", cls)} />{label}</span>;
}
function Row({ cls, label, v, pct }: { cls: string; label: string; v: number; pct: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn("mt-1 h-2.5 w-2.5 rounded-[3px]", cls)} />
      <div><p className="font-medium">{label}: {v}</p><p className="text-[11px] text-muted-foreground">{pct}</p></div>
    </div>
  );
}

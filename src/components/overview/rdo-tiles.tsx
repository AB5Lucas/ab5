/**
 * Quadro de RDOs em quadradinhos (Atividades): cada coluna = dia (ou mês); a altura é o nº de clientes com equipe
 * escalada no mês e cada quadradinho preenchido é um cliente com RDO (escuro = finalizado, médio = rascunho).
 * Clicar numa coluna mostra o resumo ao lado.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SummaryPanel, SummaryHead, SummaryRow } from "./patio-calendar";

export type TileCol = { key: string; label: string; title: string; max: number; fin: number; draft: number; expected: number; totalFin?: number; totalDraft?: number; totalExpected?: number };


export function RdoTiles({ cols, unit }: { cols: TileCol[]; unit: "day" | "month" }) {
  const [sel, setSel] = useState<number | null>(null);
  const top = Math.max(1, ...cols.map((c) => c.max));
  const per: number = 2; // clientes por quadradinho (fixo)
  const rows = Math.ceil(top / per);
  const i = sel ?? -1;
  const c0 = cols[i];
  // Sem coluna escolhida: resumo do período inteiro.
  const sum = (f: (x: TileCol) => number) => cols.reduce((a, x) => a + f(x), 0);
  const c = c0 ?? (cols.length ? { title: unit === "day" ? "Resumo do mês" : "Resumo do período", max: Math.max(0, ...cols.map((x) => x.max)) } as TileCol : undefined);
  const fin = c0 ? (unit === "month" ? c0.totalFin ?? 0 : c0.fin) : sum((x) => (unit === "month" ? x.totalFin ?? 0 : x.fin));
  const draft = c0 ? (unit === "month" ? c0.totalDraft ?? 0 : c0.draft) : sum((x) => (unit === "month" ? x.totalDraft ?? 0 : x.draft));
  const exp = c0 ? (unit === "month" ? c0.totalExpected ?? 0 : c0.expected) : sum((x) => (unit === "month" ? x.totalExpected ?? 0 : x.expected));
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
              <button key={col.key} type="button" onClick={() => setSel(sel === ci ? null : ci)} title={`${col.title}: ${col.fin + col.draft} de ${col.max} clientes`}
                className={cn("flex flex-1 flex-col items-stretch gap-[3px] rounded-md p-[2px] transition-colors", ci === i && "bg-muted ring-1 ring-border")}>
                {Array.from({ length: rows }, (_, r) => {
                  const fromBottom = rows - 1 - r;
                  const cls = fromBottom >= cap ? "bg-transparent"
                    : fromBottom < f ? "bg-foreground"
                    : fromBottom < f + dr ? "bg-foreground/45"
                    : "border border-dashed border-border bg-muted/40";
                  return <span key={r} className={cn("ov-grow w-full rounded-[4px]", "h-5", cls)} style={{ animationDelay: `${ci * 25 + fromBottom * 15}ms` }} />;
                })}
                <span className="mt-1 text-center text-[10px] tabular-nums text-muted-foreground">{ci % step === 0 || ci === i ? col.label : "\u00a0"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {c && (
        <SummaryPanel>
          <SummaryHead label={c.title} value={fin + draft} sub={`RDOs de ${exp} esperados`} />
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground transition-[width] duration-700" style={{ width: exp ? `${(fin / exp) * 100}%` : 0 }} />
            <div className="h-full bg-foreground/45 transition-[width] duration-700" style={{ width: exp ? `${(draft / exp) * 100}%` : 0 }} />
          </div>
          <div className="space-y-0.5">
            <SummaryRow dot="bg-foreground" label="Finalizados" value={fin} sub={pct(fin)} />
            <SummaryRow dot="bg-foreground/45" label="Rascunho" value={draft} sub={pct(draft)} />
            <SummaryRow dot="border border-dashed border-border bg-muted/40" label="Sem RDO" value={Math.max(0, exp - fin - draft)} sub={pct(Math.max(0, exp - fin - draft))} />
          </div>
          <p className="mt-auto text-[10px] leading-relaxed text-muted-foreground">{c0 ? `${c.max} clientes com equipe no mês` : "Clique num dia para ver só ele"}<br />1 quadradinho = {per} {per === 1 ? "cliente" : "clientes"}{unit === "month" ? " (média por dia)" : ""}</p>
        </SummaryPanel>
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

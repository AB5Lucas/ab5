import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Big, HoverBars, OverviewCard } from "@/components/overview/charts";
import { PatioCalendar } from "@/components/overview/patio-calendar";

/**
 * Quadros guardados para o futuro dashboard da Programação (saíram da visão geral de Atividades em 25/11, a pedido).
 * Os dados vêm prontos da página que os usar (mesma conta que estava em routes/_authenticated/atividades.tsx:
 * pplSeries, patioDays/patioCount e moRows).
 */
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Pessoas escaladas por dia (ou média por dia no mês). */
export function PeopleScheduledCard({ series, unit }: { series: { label: string; value: number; tip?: string }[]; unit: "day" | "month" }) {
  return (
    <OverviewCard title={unit === "day" ? "Pessoas escaladas por dia" : "Pessoas escaladas por dia (média do mês)"} to="/programacao/diaria" linkLabel="Abrir Programação" hint="Alocações em serviços na Programação">
      <Big value={Math.round(series.reduce((a, x) => a + x.value, 0) / Math.max(1, series.filter((x) => x.value > 0).length))} />
      <p className="text-xs text-muted-foreground">média por dia com equipe</p>
      <div className="mt-3"><HoverBars data={series} format={(v) => `${v} pessoas`} height="h-20" /></div>
    </OverviewCard>
  );
}

/** Pessoas no cliente Pátio no período, em calendário. */
export function PatioCard({ days, unit, total }: { days: { key: string; label: string; title: string; value: number }[]; unit: "day" | "month"; total: number }) {
  const workforce = useQuery({ queryKey: ["active-collaborators-count"], staleTime: 10 * 60_000, queryFn: async () => (await supabase.from("collaborators").select("id", { count: "exact", head: true }).eq("status", "active")).count ?? 0 });
  return (
    <OverviewCard title="Pessoas no Pátio" to="/programacao/diaria" linkLabel="Abrir Programação" hint="Pessoas escaladas no cliente Pátio no período">
      <div onClick={(e) => e.preventDefault()}><PatioCalendar days={days} unit={unit} total={total} workforce={workforce.data ?? 0} /></div>
    </OverviewCard>
  );
}

/** MO: horas normais × HE por cliente. */
export function MoCard({ rows }: { rows: { label: string; normal: number; extra: number }[] }) {
  return (
    <OverviewCard title="MO: horas normais × HE" to="/fechamentos/financeiro" linkLabel="Ver financeiro" hint="Custo de MO das escalações por cliente (HE = acima de 8 h, sábado ×1,6, domingo/feriado ×2)">
      <MoBars rows={rows} limit={4} />
    </OverviewCard>
  );
}

export function MoBars({ rows, limit = 99 }: { rows: { label: string; normal: number; extra: number }[]; limit?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.normal + r.extra));
  const tot = rows.reduce((a, r) => ({ n: a.n + r.normal, x: a.x + r.extra }), { n: 0, x: 0 });
  if (!rows.length) return <p className="py-8 text-center text-xs text-muted-foreground">Sem escalações no período.</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground" />Normais {brl(tot.n)}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-foreground/35" />HE {brl(tot.x)}</span>
      </div>
      {rows.slice(0, limit).map((r) => (
        <div key={r.label} title={`${r.label}: normais ${brl(r.normal)} · HE ${brl(r.extra)}`}>
          <div className="flex justify-between text-[11px]"><span className="truncate">{r.label}</span><span className="tabular-nums text-muted-foreground">{brl(r.normal + r.extra)}</span></div>
          <div className="mt-0.5 flex h-2 overflow-hidden rounded-full bg-muted" style={{ width: `${((r.normal + r.extra) / max) * 100}%` }}>
            <span className="ov-grow h-full bg-foreground" style={{ width: `${(r.normal / Math.max(1, r.normal + r.extra)) * 100}%` }} />
            <span className="ov-grow h-full bg-foreground/35" style={{ width: `${(r.extra / Math.max(1, r.normal + r.extra)) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

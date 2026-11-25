import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkScope } from "@/hooks/use-work-scope";
import { Big, MarginLine, OverviewCard } from "@/components/overview/charts";
import { loadResultShared } from "@/lib/results-engine";
import { financeBatches, financeList, loadFinanceActive, loadFinanceRaws } from "@/lib/finance-data";
import { directorSummary } from "@/lib/director-overview";

/**
 * Quadro guardado para o futuro dashboard do Financeiro (saiu da visão geral de Atividades em 25/11, a pedido):
 * margem média dos serviços por mês, com a MESMA conta do Fechamento/Financeiro (loadFinanceRaws + directorSummary).
 * É a leitura mais pesada das visões gerais (histórico de RDO, folgas, férias, recorrências), por isso fica só lá.
 * period: from = 1º dia; unit "day" = um mês (lista por cliente), "month" = vários meses (linha por mês); yms = meses do período.
 */
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pad = (n: number) => String(n).padStart(2, "0");
const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

export function MarginCard({ period }: { period: { from: string; unit: "day" | "month"; yms: string[] } }) {
  const scope = useWorkScope();
  const P = period;
  const finStart = P.from;
  const y0 = P.yms[0]!;
  const finEnd = P.unit === "day" ? `${y0}-${pad(new Date(Number(y0.slice(0, 4)), Number(y0.slice(5, 7)), 0).getDate())}` : `${y0.slice(0, 4)}-12-31`;
  const fWorks = useQuery({ queryKey: ["fin-works"], queryFn: async () => (await supabase.from("works").select("*, clients(name)").order("name")).data ?? [] });
  const holidays = useQuery({ queryKey: ["holidays-dates"], queryFn: async () => ((await supabase.from("holidays").select("date")).data ?? []).map((h) => h.date as string) });
  const fActive = useQuery({ queryKey: ["fin-active", finStart, finEnd], placeholderData: keepPreviousData, queryFn: () => loadFinanceActive(finStart, finEnd) });
  const shared = useQuery({ queryKey: ["fin-shared"], staleTime: 60_000, queryFn: loadResultShared });
  const fList = useMemo(() => financeList(fWorks.data ?? [], fActive.data, finStart, finEnd).filter((w: any) => scope.allowWork(w)), [fWorks.data, fActive.data, finStart, finEnd, scope.allowWork]); // eslint-disable-line react-hooks/exhaustive-deps
  const batches = useMemo(() => financeBatches(fList), [fList]);
  const batchKey = useMemo(() => batches.map((b) => `${b.key}:${b.ids.join(",")}`).sort().join("|"), [batches]);
  const raws = useQuery({
    queryKey: ["fin-client-raw", batchKey, finEnd], placeholderData: keepPreviousData, staleTime: 60_000,
    enabled: !!shared.data && !!fActive.data,
    queryFn: () => loadFinanceRaws(batches, shared.data!, { until: finEnd }),
  });
  const margin = useMemo(() => {
    if (!raws.data) return null;
    const s = directorSummary(fList, raws.data, P.yms, holidays.data ?? [], fWorks.data ?? []);
    const months = s.months.filter((m) => m.pct != null);
    const avg = months.length ? months.reduce((a, m) => a + m.pct!, 0) / months.length : null;
    return { avg, months: s.months, clients: (s.clients ?? []).filter((c: any) => c.comp > 0 && c.pct != null).sort((a: any, b: any) => b.comp - a.comp) };
  }, [raws.data, fList, P.yms, holidays.data, fWorks.data]);

  return (
    <OverviewCard title="Margem média dos serviços por mês" to="/fechamentos/financeiro" linkLabel="Ver Financeiro" hint="Média da margem de contribuição de cada mês do período (mesma conta do Financeiro)">
      {margin ? (
        <>
          <Big value={fmtPct(margin.avg)} />
          <p className="text-xs text-muted-foreground">{margin.months.length > 1 ? `média de ${margin.months.filter((m) => m.pct != null).length} meses` : "no mês"}</p>
          <div className="mt-2"><MarginLine data={P.unit === "day"
            ? margin.clients.map((c: any) => ({ label: c.name, pct: c.pct }))
            : margin.months.filter((m) => m.pct != null).map((m) => ({ label: `${MONTHS[Number(m.ym.slice(5, 7)) - 1]}/${m.ym.slice(2, 4)}`, pct: m.pct! }))} /></div>
        </>
      ) : <div className="h-16 animate-pulse rounded-lg bg-muted" />}
    </OverviewCard>
  );
}

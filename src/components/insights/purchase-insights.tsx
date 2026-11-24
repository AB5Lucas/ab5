/**
 * Blocos vivos de Compras (Solicitações, Validação e Comprador): usam as SCs que a página já leu
 * (a RLS decide o que cada pessoa vê), então a faixa se adapta à página sem nova leitura das SCs.
 * 5. Fila com contagem regressiva · 6. Onde a SC está parada · 7. Tempo médio de compra · 8. Verba × comprado por cliente.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, Hourglass, ListOrdered, Timer, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/purchase-requests";
import {
  budgetVsBought, FLOW_STAGES, leadTimeTrend, stageSummary, urgentQueue, type FlowStage, type ItemLike, type ScLike,
} from "@/lib/insights/purchases";
import { shortBR } from "@/lib/insights/dates";
import { useClientsList, useScUsers, todayISO } from "@/components/compras/sc-shared";
import { CountUp } from "@/components/count-up";
import { Bar, BigNumber, InsightCard, InsightRow, InsightStrip } from "@/components/insights";
import { cn } from "@/lib/utils";

const CHUNK = 150;
const fmtDays = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${n === 1 ? "dia" : "dias"}`;

/** Itens (verba e status) das SCs enviadas no mês, em lotes de ids. */
function useMonthItems(ids: string[]) {
  return useQuery({
    queryKey: ["insights", "sc-items", ids],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const out: ItemLike[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data, error } = await supabase.from("purchase_request_items").select("request_id, budget, status").in("request_id", ids.slice(i, i + CHUNK));
        if (error) throw error;
        out.push(...(data ?? []));
      }
      return out;
    },
  });
}

export function PurchaseInsights({ id, rows, loading, stage, onStage }: {
  /** Página (lembra se a faixa está recolhida). */
  id: string;
  rows: ScLike[];
  loading?: boolean | undefined;
  /** Etapa filtrada na lista (clique no quadro "Onde a SC está parada"). */
  stage: FlowStage | null;
  onStage: (s: FlowStage | null) => void;
}) {
  const navigate = useNavigate();
  const today = todayISO();
  const month = today.slice(0, 7);
  const clients = useClientsList();
  const users = useScUsers();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const userName = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.email || "—"])), [users.data]);

  const queue = useMemo(() => urgentQueue(rows, today), [rows, today]);
  const stages = useMemo(() => stageSummary(rows, today), [rows, today]);
  const lead = useMemo(() => leadTimeTrend(rows, today), [rows, today]);
  const monthIds = useMemo(() => rows.filter((r) => r.sent_at?.slice(0, 7) === month).map((r) => r.id).sort(), [rows, month]);
  const items = useMonthItems(monthIds);
  const budgets = useMemo(() => budgetVsBought(rows, items.data ?? [], month), [rows, items.data, month]);
  const late = queue.filter((q) => q.late).length;
  const maxBudget = Math.max(1, ...budgets.map((b) => b.budget));

  return (
    <InsightStrip id={`compras-${id}`} summary={`${late} atrasada${late === 1 ? "" : "s"} na fila · ${stages.map((s) => `${s.label}: ${s.count}`).join(" · ")}`}>
      <InsightCard title="Fila por prazo" icon={<Hourglass />} loading={loading} tone={late ? "alert" : queue.length ? "warn" : "ok"} pulse={late > 0}
        hint="As 5 SCs enviadas e em aberto com o prazo mais próximo (controle de prazo da planilha). A barra esvazia do envio até a data prazo; vermelho = fora do prazo. Clique para abrir a SC.">
        {queue.length ? (
          <div className="space-y-1.5">
            {queue.map((q) => (
              <InsightRow key={q.row.id} className="flex-col items-stretch gap-0.5"
                title={`${q.row.number} · ${q.row.requester_name}${q.row.client_id ? ` · ${clientName.get(q.row.client_id) ?? ""}` : ""}\nPrazo ${shortBR(q.row.due_date!)} · ${q.deadline}`}
                onClick={() => navigate({ to: "/compras/solicitacoes/$id", params: { id: q.row.id } })}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{q.row.number}</span>
                  <span className={cn("shrink-0 tabular-nums", q.late ? "font-semibold text-destructive" : q.daysLeft <= 2 ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground")}>
                    {q.late ? `atrasada ${Math.abs(q.daysLeft)}d` : q.daysLeft === 0 ? "vence hoje" : `${q.daysLeft}d`}
                  </span>
                </div>
                <Bar value={q.late ? 1 : q.fractionLeft} className={q.late ? "bg-destructive" : q.fractionLeft < 0.25 ? "bg-warning" : "bg-success"} />
              </InsightRow>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">Nenhuma SC em aberto com prazo.</p>}
      </InsightCard>

      <InsightCard title="Onde a SC está parada" icon={<ListOrdered />} loading={loading}
        hint="Quantas SCs em cada etapa (Comprada = compradas neste mês) e há quanto tempo está parada a mais antiga. Clique numa etapa para filtrar a lista; clique de novo para limpar.">
        <div className="grid grid-cols-4 gap-1">
          {stages.map((s, i) => (
            <button key={s.key} type="button" onClick={(e) => { e.stopPropagation(); onStage(stage === s.key ? null : s.key); }}
              aria-pressed={stage === s.key}
              title={s.oldest ? `${s.label}: ${s.count} · mais antiga ${s.oldest.row.number} há ${fmtDays(s.oldest.days)}` : `${s.label}: ${s.count}`}
              className={cn("relative flex min-w-0 flex-col items-center rounded border px-1 py-1 text-center hover:bg-muted",
                stage === s.key ? "border-primary bg-primary/10" : "border-transparent", !s.count && "opacity-60")}>
              <span className="truncate text-[10px] text-muted-foreground">{s.label}</span>
              <span className="text-lg font-semibold tabular-nums leading-tight"><CountUp value={s.count} /></span>
              {i < FLOW_STAGES.length - 1 && <span className="absolute -right-1 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground" aria-hidden>›</span>}
            </button>
          ))}
        </div>
        {(() => {
          const worst = stages.filter((s) => s.oldest).sort((a, b) => b.oldest!.days - a.oldest!.days)[0];
          if (!worst?.oldest) return <p className="text-[11px] text-muted-foreground">Nada parado.</p>;
          const r = worst.oldest.row;
          const who = worst.key === "validacao" ? userName.get(r.approver_id ?? r.substitute_id ?? "") ?? "o validador"
            : worst.key === "rascunho" ? r.requester_name : "Comprador";
          return (
            <InsightRow onClick={() => navigate({ to: "/compras/solicitacoes/$id", params: { id: r.id } })} title={`Abrir ${r.number}`}>
              <span className={cn("truncate", worst.oldest.days >= 5 && "text-orange-600 dark:text-orange-400")}>
                {worst.label}: mais antiga há {fmtDays(worst.oldest.days)} com {who}
              </span>
            </InsightRow>
          );
        })()}
      </InsightCard>

      <InsightCard title="Tempo médio de compra · mês" icon={<Timer />} loading={loading}
        tone={lead.delta != null && lead.delta > 0 ? "warn" : "default"}
        onClick={() => onStage(stage === "comprada" ? null : "comprada")}
        hint="Média de dias do envio da SC até a compra efetivada (data do status), nas SCs compradas neste mês, comparada com o mês anterior. Almoxarifado não entra. Clique para ver as compradas.">
        <BigNumber label={lead.current.count ? `${lead.current.count} compradas no mês` : "nenhuma compra no mês"}>
          {lead.current.avg != null ? <CountUp value={`${lead.current.avg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`} /> : "—"}
        </BigNumber>
        {lead.delta != null ? (
          <div className={cn("inline-flex items-center gap-1 text-xs", lead.delta > 0 ? "text-destructive" : "text-success")}>
            {lead.delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(lead.delta).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d {lead.delta > 0 ? "mais lento" : "mais rápido"} que o mês anterior
            <span className="text-muted-foreground">({lead.previous.avg!.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d)</span>
          </div>
        ) : <p className="text-xs text-muted-foreground">{lead.previous.avg != null ? `Mês anterior: ${lead.previous.avg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d` : "Sem compras no mês anterior para comparar."}</p>}
      </InsightCard>

      <InsightCard title="Verba × comprado · mês" icon={<Wallet />} loading={loading || items.isLoading} error={items.isError}
        hint="Clientes com mais verba nas SCs enviadas neste mês (canceladas fora). Barra clara = verba; escura = verba dos itens já comprados/almoxarifado (o sistema não guarda o valor pago).">
        {budgets.length ? (
          <div className="space-y-1">
            {budgets.map((b) => (
              <div key={b.clientId} className="space-y-0.5 text-xs" title={`${clientName.get(b.clientId) ?? "—"}: verba ${brl(b.budget)} · comprado ${brl(b.bought)} (${Math.round((b.bought / b.budget) * 100)}%)`}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{clientName.get(b.clientId) ?? "—"}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{brl(b.bought)} / {brl(b.budget)}</span>
                </div>
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="insight-bar absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: `${(b.budget / maxBudget) * 100}%` }} />
                  <div className="insight-bar absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(b.bought / maxBudget) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">Sem verba nas SCs enviadas no mês.</p>}
      </InsightCard>
    </InsightStrip>
  );
}

/** Filtro da lista pela etapa escolhida no bloco. */
export { flowStage } from "@/lib/insights/purchases";

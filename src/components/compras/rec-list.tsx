import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Pill, type ScExtraCol, type ScRow } from "@/components/compras/sc-shared";
import { BudgetDot } from "@/components/compras/recommendation-view";
import { recommendation, scBudget, type Criterion, type QuoteItemLite, type QuoteLite, type ScItemLite } from "@/lib/purchase-quotes";
import { brl } from "@/lib/purchase-requests";

export type RecTotal = { total: number; budget: number | null; covered: number; items: number; quotes: number };

/** Melhor escolha × verba de cada SC da lista (cotações lidas e vínculos), para as listas da Recomendação e da Aprovação. */
export function useRecTotals(rows: ScRow[]) {
  const ids = useMemo(() => rows.map((r) => r.id).sort(), [rows]);
  const q = useQuery({
    queryKey: ["sc-rec-all", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
      const items: (ScItemLite & { request_id: string })[] = [];
      const quotes: (QuoteLite & { request_id: string })[] = [];
      for (const c of chunks) {
        const [a, b] = await Promise.all([
          supabase.from("purchase_request_items").select("id, request_id, item_no, quantity, unit, description, budget, rec_quote_item_id").in("request_id", c),
          supabase.from("purchase_quotes").select("*").in("request_id", c),
        ]);
        items.push(...((a.data ?? []) as typeof items));
        quotes.push(...((b.data ?? []) as typeof quotes));
      }
      const qItems: QuoteItemLite[] = [];
      const qIds = quotes.map((x) => x.id);
      for (let i = 0; i < qIds.length; i += 80) {
        const { data } = await supabase.from("purchase_quote_items").select("*").in("quote_id", qIds.slice(i, i + 80));
        qItems.push(...((data ?? []) as QuoteItemLite[]));
      }
      return { items, quotes, qItems };
    },
  });
  return useMemo(() => {
    const m = new Map<string, RecTotal>();
    if (!q.data) return m;
    for (const r of rows) {
      const items = q.data.items.filter((i) => i.request_id === r.id);
      const quotes = q.data.quotes.filter((x) => x.request_id === r.id);
      const qIds = new Set(quotes.map((x) => x.id));
      const rec = recommendation(items, quotes, q.data.qItems.filter((x) => qIds.has(x.quote_id)), (r.rec_criteria ?? ["valor"]) as Criterion[]);
      m.set(r.id, { total: rec.total, budget: scBudget(r.total_budget, items), covered: rec.covered, items: items.length, quotes: quotes.filter((x) => x.read_status === "lido").length });
    }
    return m;
  }, [q.data, rows]);
}

const FA_LABEL: Record<string, [string, string]> = {
  em_aprovacao: ["Em aprovação", "bg-orange-200 text-orange-950 dark:bg-orange-900/60 dark:text-orange-100"],
  aprovada: ["Aprovada", "bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-100"],
  recusada: ["Recusada", "bg-red-200 text-red-950 dark:bg-red-900/60 dark:text-red-100"],
};
export const faLabel = (r: ScRow) => (r.fa_state ? FA_LABEL[r.fa_state]?.[0] ?? r.fa_state : "Recomendação");

/** Colunas "Melhor escolha" (total com o indicador da verba) e "Aprovação". */
export function recCols(totals: Map<string, RecTotal>, useSent = false): ScExtraCol[] {
  const total = (r: ScRow) => (useSent && r.fa_total != null ? Number(r.fa_total) : totals.get(r.id)?.total ?? null);
  const budget = (r: ScRow) => (useSent && r.fa_state ? (r.fa_budget == null ? null : Number(r.fa_budget)) : totals.get(r.id)?.budget ?? null);
  return [
    { key: "best", label: "Melhor escolha", values: (r) => [total(r) ? brl(total(r)) : ""], sort: (r) => total(r), className: "whitespace-nowrap tabular-nums",
      cell: (r) => {
        const t = totals.get(r.id);
        const v = total(r);
        return v ? (
          <span className="inline-flex items-center gap-1.5" title={`Verba ${brl(budget(r))}${t ? ` · ${t.covered} de ${t.items} itens com cotação · ${t.quotes} cotações` : ""}`}>
            {brl(v)} <BudgetDot total={v} budget={budget(r)} />
          </span>
        ) : <span className="text-muted-foreground">{t?.quotes ? "sem vínculo" : "sem cotação"}</span>;
      } },
    { key: "fa", label: "Aprovação", values: (r) => [faLabel(r)], className: "whitespace-nowrap",
      cell: (r) => (r.fa_state ? (
        <span className="space-x-1">
          <Pill className={FA_LABEL[r.fa_state]?.[1] ?? ""}>{faLabel(r)}</Pill>
          {r.fa_ack_needed && <Pill className="bg-orange-100 text-orange-900" title="Aprovação dupla: falta a ciência do Marcelo">ciência pendente</Pill>}
        </span>
      ) : <span className="text-muted-foreground">—</span>) },
  ];
}

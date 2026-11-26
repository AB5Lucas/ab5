import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BadgeCheck, Check, ChevronsLeft, ChevronsRight, Columns3, Eye, FileText, Info, Link2, Loader2, Paperclip, Send, Sparkles, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { useActionHistory, useUndoRedoKeys, type ActionHistory } from "@/hooks/use-action-history";
import { UndoRedoButtons } from "@/components/compras/undo-redo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from "@/components/ui/table";
import { applyColumnFilters, FilterHead, rowsForColumn, type ColumnDef, type ColumnFilters, type ColumnSort } from "@/components/column-filter";
import { ScHeaderCard } from "@/components/compras/sc-header-card";
import { Pill, todayISO, useClientsList, useScUsers } from "@/components/compras/sc-shared";
import { QuoteMatchingDialog, QuotesAttachDialog, importRequesterQuotes, openQuoteFile, useRecData, type RecData } from "@/components/compras/quotes";
import {
  CRITERIA, RULE_LABEL, approvalRule, budgetSignal, itemsOverBudget, nextOption, prevOption, recommendation, scBudget, type Criterion, type FaRule, type RecRow,
  faOutcome, type FaOutcome,
} from "@/lib/purchase-quotes";
import { brl, itemStatusClass, statusClass, statusDot } from "@/lib/purchase-requests";
import { summarizeRecommendation } from "@/lib/purchase-quotes.functions";
import { cn } from "@/lib/utils";

const RATEIO = "Rateio geral do cliente";

/** Bolinha do indicador contra a verba (acima vermelho, igual laranja, abaixo verde). */
export function BudgetDot({ total, budget }: { total: number | null | undefined; budget: number | null | undefined }) {
  const s = budgetSignal(total, budget);
  if (s.tone === "sem") return null;
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle", s.cls)} title={`${s.label} (${brl(budget)})`} aria-label={s.label} />;
}

/** Texto da situação do item em relação à verba (coluna entre Verba e Observações). */
function budgetText(total: number | null | undefined, budget: number | null | undefined) {
  const s = budgetSignal(total, budget);
  if (s.tone === "acima") return { label: "Acima da verba", cls: "text-red-600 dark:text-red-400" };
  if (s.tone === "igual") return { label: "No limite da verba", cls: "text-orange-600 dark:text-orange-400" };
  if (s.tone === "abaixo") return { label: "Dentro da verba", cls: "text-emerald-600 dark:text-emerald-400" };
  return { label: total == null ? "Sem cotação" : "Sem verba", cls: "text-muted-foreground" };
}

/** O que a pessoa pode fazer no Aprovador, pelas Alçadas (purchase_fa_my_perms no banco). */
export type FaPerms = { exec: boolean; oper: boolean; shared: boolean; editor: boolean; decide: Set<string> };
export function useFaPerms() {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["fa-perms", user?.id], enabled: !!user?.id, staleTime: 30_000,
    queryFn: async (): Promise<FaPerms> => {
      const { data, error } = await supabase.rpc("purchase_fa_my_perms" as never);
      if (error) throw error;
      const d = (data ?? {}) as { exec?: boolean; oper?: boolean; shared?: boolean; editor?: boolean; decide?: string[] };
      return { exec: !!d.exec, oper: !!d.oper, shared: !!d.shared, editor: !!d.editor, decide: new Set(d.decide ?? []) };
    },
  });
}
const isProgrammed = (r: { nature?: string | null }) => (r.nature ?? "").toUpperCase() === "PROGRAMADA";

type Col = ColumnDef<RecRow> & { cell: (r: RecRow) => ReactNode; className?: string; fixed?: boolean };

/**
 * Tela da recomendação de uma SC (Comprador › Recomendação) e da aprovação (aba Aprovador, mode="aprovacao").
 * Mesmo cabeçalho da SC; itens com a melhor escolha pelos critérios, botão para a próxima melhor e o resumo
 * (cotações analisadas, fornecedores e critérios).
 */
export function RecommendationView({ requestId, mode, onBack, embedded, history: outerHistory, isGestor = false }: {
  requestId: string; mode: "comprador" | "aprovacao"; onBack?: () => void;
  /** Dentro da página da SC (aba Recomendação): sem Voltar/título, o cabeçalho já está na página. */
  embedded?: boolean;
  /** Desfazer/refazer da página (comprador): critérios e escolhas entram nele. */
  history?: ActionHistory;
  /** O usuário é gestor desta SC (cliente/validador), para a aprovação dupla. */
  isGestor?: boolean;
}) {
  const qc = useQueryClient();
  const { user, isAdmin } = useCurrentUser();
  const { canAccess } = useAccess();
  const isBuyer = isAdmin || canAccess("/compras/comprador");
  const perms = useFaPerms();
  const ownHistory = useActionHistory();
  const history = outerHistory ?? ownHistory;
  useUndoRedoKeys(ownHistory, !outerHistory);
  const data = useRecData(requestId);
  const clients = useClientsList();
  const users = useScUsers();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const userName = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.email || "—"])), [users.data]);
  const [attach, setAttach] = useState(false);
  const [matching, setMatching] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendNotes, setSendNotes] = useState("");
  const [decision, setDecision] = useState<"" | "aprovado" | "recusado">("");
  const [decNotes, setDecNotes] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sc-rec-hidden") ?? "[]")); } catch { return new Set(); }
  });
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["sc-rec", requestId] }), qc.invalidateQueries({ queryKey: ["sc-rec-all"] }), qc.invalidateQueries({ queryKey: ["sc-requests"] }),
    qc.invalidateQueries({ queryKey: ["fa-perms"] }),
  ]);

  const d = data.data;
  const r = d?.req;
  const criteria = (r?.rec_criteria ?? ["valor"]) as Criterion[];
  const rec = useMemo(() => (d ? recommendation(d.items, d.quotes, d.qItems, criteria) : null), [d, criteria]); // eslint-disable-line react-hooks/exhaustive-deps
  const budget = d ? scBudget(d.req.total_budget, d.items) : null;
  const editable = mode === "comprador" && !!r && r.stage === "compras" && r.fa_state !== "em_aprovacao";
  const readQuotes = (d?.quotes ?? []).filter((q) => q.read_status === "lido");

  const rpcCriteria = async (c: Criterion[]) => {
    const { error } = await supabase.rpc("purchase_rec_set_criteria" as never, { _id: requestId, _criteria: c } as never);
    if (error) { toast.error(error.message); throw error; }
    await invalidate();
  };
  const rpcChoose = async (item: string, qi: string | null) => {
    const { error } = await supabase.rpc("purchase_rec_choose" as never, { _item: item, _quote_item: qi } as never);
    if (error) { toast.error(error.message); throw error; }
    await invalidate();
  };
  const setCriteria = useMutation({
    mutationFn: async (c: Criterion[]) => {
      const { error } = await supabase.rpc("purchase_rec_set_criteria" as never, { _id: requestId, _criteria: c } as never);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const choose = useMutation({
    mutationFn: async ({ item, qi }: { item: string; qi: string | null }) => {
      const { error } = await supabase.rpc("purchase_rec_choose" as never, { _item: item, _quote_item: qi } as never);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const send = useMutation({
    mutationFn: async () => {
      const snapshot = {
        criteria, total: rec!.total, budget,
        items: rec!.rows.filter((x) => x.chosen).map((x) => ({
          item_id: x.item.id, item_no: x.item.item_no, description: x.item.description, quantity: x.item.quantity, unit: x.item.unit, budget: x.item.budget,
          quote_id: x.chosen!.quote.id, quote_item_id: x.chosen!.quoteItem.id, supplier: x.chosen!.quote.supplier, unit_price: x.chosen!.unitPrice,
          total: x.chosen!.total, options: x.options.length, manual: x.manual,
        })),
      };
      const { data: rule, error } = await supabase.rpc("purchase_fa_send" as never, { _id: requestId, _notes: sendNotes, _total: Math.round(rec!.total * 100) / 100, _snapshot: snapshot } as never);
      if (error) throw error;
      return rule as unknown as FaRule;
    },
    onSuccess: (rule) => { toast.success(`Enviada ao aprovador · ${RULE_LABEL[rule] ?? ""}`); setSending(false); setSendNotes(""); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const recall = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_fa_recall" as never, { _id: requestId } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("SC tirada da aprovação"); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Envio ao comprador pelo estado dos itens em aprovação (o que vale é o item, não só o dropdown Decisão).
  const faItems = (data.data?.items ?? []).filter((i) => ["APROVAÇÃO PENDENTE", "APROVADO", "RECUSADO"].includes(i.status));
  const faCount = {
    approved: faItems.filter((i) => i.status === "APROVADO").length,
    rejected: faItems.filter((i) => i.status === "RECUSADO").length,
    pending: faItems.filter((i) => i.status === "APROVAÇÃO PENDENTE").length,
  };
  const outcome: FaOutcome | null = faOutcome(faCount.approved, faCount.rejected, faCount.pending)
    ?? (faCount.pending > 0 && decision === "aprovado" ? (faCount.rejected > 0 ? "parcial" : "aprovada")
      : faCount.pending > 0 && decision === "recusado" ? "recusada" : null);
  const reasonNeeded = outcome === "recusada" && faItems.some((i) => {
    const m = ((i.fa_item_reason as string | null) ?? "").trim();
    return i.status !== "RECUSADO" || !m || m === "Recusado na decisão geral";
  });
  const decide = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_fa_decide" as never, { _id: requestId, _approve: outcome !== "recusada", _notes: decNotes } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      const partial = outcome !== "recusada" && r?.fa_rule !== "verba" && approvalRule(Number(r?.fa_total ?? 0), r?.fa_budget == null ? null : Number(r.fa_budget), r?.due_date ?? null, todayISO(), !!r?.fa_over_items, !!r && isProgrammed(r)) === "dupla" && !perms.data?.exec && !r?.fa_partial_side;
      toast.success(partial ? "Sua aprovação foi registrada: falta a do outro lado (comprador ou gestor)"
        : outcome === "aprovada" ? "Aprovada: todos os itens aprovados"
        : outcome === "parcial" ? `Aprovada parcialmente: ${faCount.approved + faCount.pending} aprovados, ${faCount.rejected} recusados`
        : "Recusada: todos os itens recusados");
      setDecision(""); setDecNotes(""); void invalidate(); if (!partial) onBack?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const ack = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_fa_ack" as never, { _id: requestId } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Ciência registrada"); void invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cotações e links do solicitante/validador entram sozinhos (o comprador não precisa abrir o clipe).
  const imported = useRef(false);
  // Observação da decisão (início da digitação), para o desfazer. Fica antes dos retornos: hooks sempre na mesma ordem.
  const notesStart = useRef<string | null>(null);
  const [confirmValor, setConfirmValor] = useState<Criterion[] | null>(null);
  // Aprovação item a item: recusa pede motivo; resumo geral pela IA.
  const [refuse, setRefuse] = useState<{ id: string; no: number; desc: string; before: string; beforeReason: string | null } | null>(null);
  const [refuseReason, setRefuseReason] = useState("");
  const [aiText, setAiText] = useState<string | null>(null);
  const rpcItem = async (item: string, status: string, reason: string | null) => {
    const { error } = await supabase.rpc("purchase_fa_item_decide" as never, { _item: item, _status: status, _reason: reason ?? "" } as never);
    if (error) { toast.error(error.message); throw error; }
    await invalidate();
  };
  const itemDecide = useMutation({
    mutationFn: async (v: { item: string; no: number; status: string; reason: string | null; before: string; beforeReason: string | null }) => { await rpcItem(v.item, v.status, v.reason); return v; },
    onSuccess: (v) => {
      setRefuse(null); setRefuseReason("");
      history.push({ label: `Item ${v.no}: ${v.status === "APROVADO" ? "Aprovado" : "Recusado"}`, undo: () => rpcItem(v.item, v.before, v.beforeReason), redo: () => rpcItem(v.item, v.status, v.reason) });
    },
  });
  const aiSummary = useMutation({
    mutationFn: async (context: string) => (await summarizeRecommendation({ data: { requestId, context } })).summary,
    onSuccess: (t) => setAiText(t || "A IA não devolveu texto."),
    onError: (e: Error) => { setAiText(null); toast.error(e.message); },
  });
  useEffect(() => {
    if (imported.current || mode !== "comprador" || !d || d.req.stage !== "compras" || d.req.fa_state === "em_aprovacao" || !isBuyer) return;
    imported.current = true;
    void importRequesterQuotes(d).then((n) => { if (n) void invalidate(); });
  }, [d, mode, isBuyer]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!d || !r || !rec) return <p className="text-sm text-muted-foreground">Solicitação não encontrada ou sem acesso.</p>;

  const workName = new Map(d.works.map((w) => [w.id, w.name]));
  const ccOf = (x: RecRow["item"]) => {
    const it = d.items.find((i) => i.id === x.id)!;
    if (it.cc_code) return it.cc_code;
    if (!d.prefix) return "—";
    if (!it.work_id) return `${d.prefix}999`;
    const s = d.works.find((w) => w.id === it.work_id)?.cc_suffix;
    return s ? `${d.prefix}${s}` : "—";
  };
  const full = (x: RecRow) => d.items.find((i) => i.id === x.item.id)!;
  const supplierOf = (x: RecRow) => x.chosen?.quote.supplier ?? (x.chosen ? "Fornecedor sem nome" : "");
  const critLabel = criteria.map((c) => CRITERIA.find((k) => k.value === c)?.label ?? c).join(" + ");

  const mayDecide = mode === "aprovacao" && !!perms.data?.decide.has(r.id);
  const cols: Col[] = [
    { key: "item", label: "Item", values: (x) => [String(x.item.item_no)], sort: (x) => x.item.item_no, fixed: true, cell: (x) => x.item.item_no },
    { key: "qty", label: "Qtd", values: (x) => [String(x.item.quantity)], sort: (x) => Number(x.item.quantity), className: "tabular-nums", cell: (x) => x.item.quantity },
    { key: "unit", label: "Un. medida", values: (x) => [x.item.unit], cell: (x) => x.item.unit },
    { key: "desc", label: "Descrição", values: (x) => [x.item.description], fixed: true, className: "min-w-56", cell: (x) => x.item.description },
    { key: "best_unit", label: "Melhor valor unit.", values: (x) => [x.chosen ? brl(x.chosen.unitPrice) : ""], sort: (x) => x.chosen?.unitPrice ?? null, className: "whitespace-nowrap tabular-nums",
      cell: (x) => (x.chosen ? brl(x.chosen.unitPrice) : <span className="text-muted-foreground">sem cotação</span>) },
    { key: "best_total", label: "Valor total", values: (x) => [x.chosen ? brl(x.chosen.total) : ""], sort: (x) => x.chosen?.total ?? null, className: "whitespace-nowrap tabular-nums font-medium",
      cell: (x) => (x.chosen ? <span className="inline-flex items-center gap-1.5">{brl(x.chosen.total)} <BudgetDot total={x.chosen.total} budget={x.item.budget} /></span> : "—") },
    { key: "supplier", label: "Fornecedor", values: (x) => [supplierOf(x)], className: "min-w-40",
      cell: (x) => (x.chosen ? (
        <div className="flex items-center gap-1.5">
          <button type="button" className="text-left hover:underline" title="Abrir a cotação" onClick={() => void openQuoteFile(x.chosen!.quote.file_path)}>{supplierOf(x)}</button>
          {x.manual && <Pill className="bg-sky-100 text-sky-950 dark:bg-sky-900/50 dark:text-sky-100" title="Escolhida pelo comprador (não é a 1ª pelos critérios)">{x.index + 1}ª opção</Pill>}
        </div>
      ) : "—") },
    { key: "choice", label: "Escolha", values: (x) => [`${x.options.length} opções`], fixed: true, className: "whitespace-nowrap",
      cell: (x) => {
        const next = nextOption(x.options, x.index);
        const prev = prevOption(x.options, x.index);
        return (
          <div className="flex items-center gap-1">
            {editable && prev && x.options.length > 2 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title={`Escolha anterior: ${prev.quote.supplier ?? "—"} · ${brl(prev.total)}`} disabled={choose.isPending}
                onClick={() => {
                  const qi = x.options.indexOf(prev) === 0 ? null : prev.quoteItem.id;
                  const before = x.item.rec_quote_item_id;
                  choose.mutate({ item: x.item.id, qi }, { onSuccess: () => history.push({ label: `Item ${x.item.item_no}: ${prev.quote.supplier ?? "escolha anterior"}`, undo: () => rpcChoose(x.item.id, before), redo: () => rpcChoose(x.item.id, qi) }) });
                }}>
                <ChevronsLeft className="h-3.5 w-3.5" /> Anterior
              </Button>
            )}
            {editable && next && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title={`Próxima melhor escolha: ${next.quote.supplier ?? "—"} · ${brl(next.total)}`} disabled={choose.isPending}
                onClick={() => {
                  const qi = x.options.indexOf(next) === 0 ? null : next.quoteItem.id;
                  const before = x.item.rec_quote_item_id;
                  choose.mutate({ item: x.item.id, qi }, { onSuccess: () => history.push({ label: `Item ${x.item.item_no}: ${next.quote.supplier ?? "próxima escolha"}`, undo: () => rpcChoose(x.item.id, before), redo: () => rpcChoose(x.item.id, qi) }) });
                }}>
                <ChevronsRight className="h-3.5 w-3.5" /> Próxima
              </Button>
            )}
            <ItemSummary row={x} quotesRead={readQuotes.length} criteria={critLabel} />
          </div>
        );
      } },
    { key: "status", label: "Status", values: (x) => [full(x).status], fixed: mode === "aprovacao", className: "whitespace-nowrap",
      cell: (x) => {
        const it = full(x);
        const inFa = ["APROVAÇÃO PENDENTE", "APROVADO", "RECUSADO"].includes(it.status);
        const reason = it.status === "RECUSADO" ? it.fa_item_reason : null;
        if (mayDecide && inFa) {
          return (
            <div className="space-y-0.5">
              <Select value={it.status === "APROVAÇÃO PENDENTE" ? "" : it.status} disabled={itemDecide.isPending}
                onValueChange={(v) => {
                  if (v === it.status) return;
                  if (v === "RECUSADO") { setRefuseReason(""); setRefuse({ id: it.id, no: it.item_no, desc: it.description, before: it.status, beforeReason: it.fa_item_reason ?? null }); return; }
                  itemDecide.mutate({ item: it.id, no: it.item_no, status: v, reason: null, before: it.status, beforeReason: it.fa_item_reason ?? null });
                }}>
                <SelectTrigger className={cn("h-7 w-44 rounded-md border-0 px-2 text-[11px]", itemStatusClass(it.status))}>
                  <SelectValue placeholder="APROVAÇÃO PENDENTE" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="APROVADO"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Aprovado</span></SelectItem>
                  <SelectItem value="RECUSADO"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" /> Recusado</span></SelectItem>
                </SelectContent>
              </Select>
              {reason && <div className="max-w-44 truncate text-[11px] text-muted-foreground" title={reason}>Motivo: {reason}</div>}
            </div>
          );
        }
        return (
          <div className="space-y-0.5">
            <Pill className={itemStatusClass(it.status)} title={reason ? `Motivo: ${reason}` : undefined}>{it.status}</Pill>
            {reason && <div className="max-w-44 truncate text-[11px] text-muted-foreground" title={reason}>Motivo: {reason}</div>}
          </div>
        );
      } },
    { key: "budget", label: "Verba (R$)", values: (x) => [brl(x.item.budget)], sort: (x) => x.item.budget, className: "whitespace-nowrap tabular-nums", cell: (x) => brl(x.item.budget) },
    { key: "budget_state", label: "Situação da verba", values: (x) => [budgetText(x.chosen?.total, x.item.budget).label], className: "whitespace-nowrap",
      cell: (x) => { const t = budgetText(x.chosen?.total, x.item.budget); return <span className={cn("text-xs font-medium", t.cls)}>{t.label}</span>; } },
    { key: "notes", label: "Observações", values: (x) => [full(x).notes ?? ""], className: "max-w-48 truncate", cell: (x) => full(x).notes ?? "—" },
    { key: "work", label: "Centro de custo", values: (x) => [full(x).work_id ? workName.get(full(x).work_id!) ?? "—" : RATEIO], className: "max-w-48 truncate",
      cell: (x) => (full(x).work_id ? workName.get(full(x).work_id!) ?? "—" : RATEIO) },
    { key: "cc", label: "CC", values: (x) => [ccOf(x.item)], className: "font-mono", cell: (x) => ccOf(x.item) },
  ];
  const visible = cols.filter((c) => c.fixed || !hidden.has(c.key));
  const shown = applyColumnFilters(rec.rows, visible, filters, sort);
  const toggleCol = (k: string) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(k)) n.delete(k); else n.add(k);
    try { localStorage.setItem("sc-rec-hidden", JSON.stringify([...n])); } catch { /* ignora */ }
    return n;
  });
  const totalIdx = visible.findIndex((c) => c.key === "best_total");
  const rule = r.fa_state === "em_aprovacao"
    ? approvalRule(Number(r.fa_total ?? 0), r.fa_budget == null ? null : Number(r.fa_budget), r.due_date, todayISO(), !!r.fa_over_items, isProgrammed(r))
    : approvalRule(rec.total, budget, r.due_date, todayISO(), itemsOverBudget(rec.rows), isProgrammed(r));
  const overCount = rec.rows.filter((x) => itemsOverBudget([x])).length;
  const applyCriteria = (n: Criterion[]) => {
    const before = criteria;
    setCriteria.mutate(n, { onSuccess: () => history.push({ label: `Critérios: ${n.map((k) => CRITERIA.find((c) => c.value === k)?.label).join(" + ")}`, undo: () => rpcCriteria(before), redo: () => rpcCriteria(n) }) });
  };
  const partialWaiting = r.fa_state === "em_aprovacao" && !!r.fa_partial_side;
  // Retrato da SC para o resumo da IA (geral).
  const aiContext = () => {
    const rr = r as RecData["req"] & { justification?: string | null; nature?: string | null; priority?: string | null; category?: string | null };
    const lines = [
      `SC ${r.number} · cliente ${clientName.get(r.client_id ?? "") ?? "—"} · categoria ${rr.category ?? "—"} · natureza ${rr.nature ?? "—"} · prioridade ${rr.priority ?? "—"} · prazo de entrega ${r.due_date ?? "—"}`,
      `Justificativa: ${rr.justification ?? "—"}`,
      `Critérios da escolha: ${critLabel}`,
      `Total recomendado: ${brl(r.fa_state === "em_aprovacao" ? Number(r.fa_total ?? rec.total) : rec.total)} · verba da SC: ${brl(budget)} · ${budgetSignal(rec.total, budget).label}`,
      `Regra de aprovação: ${RULE_LABEL[rule] ?? rule}`,
      r.fa_notes ? `Observação do comprador: ${r.fa_notes}` : "",
      `Cotações analisadas: ${readQuotes.length}`,
      ...readQuotes.map((q) => `- Cotação ${q.supplier ?? "sem nome"}${q.source === "solicitante" ? " (do solicitante)" : ""}: total ${brl(q.total)}, pagamento ${q.payment_terms ?? (q.payment_days != null ? `${q.payment_days} dias` : "?")}, entrega ${q.delivery_days != null ? `${q.delivery_days} dias` : "?"}, frete ${brl(q.freight)}`),
      "Itens:",
      ...rec.rows.map((x) => `- ${x.item.item_no}. ${x.item.quantity} ${x.item.unit} ${x.item.description} · verba ${brl(x.item.budget)} · ${x.chosen ? `escolhido ${supplierOf(x)} ${brl(x.chosen.unitPrice)} un. = ${brl(x.chosen.total)}${x.manual ? ` (troca manual: ${x.index + 1}ª opção)` : ""}` : "sem cotação"} · ${x.options.length} opções · status ${full(x).status}${full(x).fa_item_reason ? ` (motivo: ${full(x).fa_item_reason})` : ""}`),
    ];
    return lines.filter(Boolean).join("\n");
  };
  // Aprovador: desfazer/refazer da escolha (Aprovado/Recusado) e da observação antes de enviar.
  // A decisão geral aplica o mesmo status a todos os itens em aprovação (purchase_fa_items_all); depois ainda dá para mudar item a item.
  const rpcAll = async (status: string, reason: string) => {
    const { error } = await supabase.rpc("purchase_fa_items_all" as never, { _id: requestId, _status: status, _reason: reason } as never);
    if (error) { toast.error(error.message); throw error; }
    await invalidate();
  };
  const changeDecision = async (v: typeof decision) => {
    const before = decision;
    if (before === v) return;
    const snap = d.items.filter((i) => ["APROVAÇÃO PENDENTE", "APROVADO", "RECUSADO"].includes(i.status))
      .map((i) => ({ id: i.id, status: i.status, reason: (i.fa_item_reason as string | null) ?? null }));
    const apply = async () => { if (v) await rpcAll(v === "aprovado" ? "APROVADO" : "RECUSADO", v === "recusado" ? decNotes : ""); };
    try { await apply(); } catch { return; }
    setDecision(v);
    history.push({
      label: `Decisão: ${v === "aprovado" ? "Aprovado" : v === "recusado" ? "Recusado" : "—"}`,
      undo: async () => { for (const it of snap) await rpcItem(it.id, it.status, it.reason); setDecision(before); },
      redo: async () => { await apply(); setDecision(v); },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!embedded && <>
          {onBack && <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Voltar</Button>}
          <span className={`inline-block h-3 w-3 rounded-full ${statusDot(r.status)}`} title={r.status} />
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{r.number}</h2>
        </>}
        <div className="ml-auto flex flex-wrap gap-2">
          {(mode === "aprovacao" ? mayDecide : editable) && (
            <span className="flex items-center gap-1 self-center text-xs text-muted-foreground" title="Cada mudança (critérios, escolha, cotações) é gravada na hora; não precisa salvar">
              <Check className="h-3.5 w-3.5" /> Salvo automaticamente
            </span>
          )}
          {!outerHistory && (mode === "aprovacao" ? mayDecide : editable) && (
            <UndoRedoButtons undoLabels={history.undoLabels} redoLabels={history.redoLabels} onUndo={(n) => void history.undo(n)} onRedo={(n) => void history.redo(n)} />
          )}
          {mode === "aprovacao" && (
            <Button variant="outline" size="sm" disabled={aiSummary.isPending} title="Resumo geral da SC feito pela IA"
              className="border-violet-400/50 text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
              onClick={() => aiSummary.mutate(aiContext())}>
              {aiSummary.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Resumo IA ✨
            </Button>
          )}
          {editable && <Button variant="outline" size="sm" onClick={() => setAttach(true)}><Paperclip className="h-4 w-4" /> Cotações</Button>}
          {editable && readQuotes.length > 0 && <Button variant="outline" size="sm" onClick={() => setMatching(true)}><Link2 className="h-4 w-4" /> Vincular itens</Button>}
          {editable && <Button size="sm" disabled={!rec.covered} onClick={() => setSending(true)}><Send className="h-4 w-4" /> Enviar ao Aprovador</Button>}
          {mode === "comprador" && r.fa_state === "em_aprovacao" && (
            <Button variant="outline" size="sm" disabled={recall.isPending} onClick={() => recall.mutate()}><Undo2 className="h-4 w-4" /> Puxar da aprovação</Button>
          )}
          {mode === "aprovacao" && r.fa_ack_needed && !!perms.data?.exec && (
            <Button size="sm" disabled={ack.isPending} onClick={() => ack.mutate()}><BadgeCheck className="h-4 w-4" /> Dar ciência</Button>
          )}
        </div>
      </div>

      {mayDecide && (
        <div className="panel flex flex-wrap items-end gap-3 p-3">
          <div className="space-y-1">
            <Label className="block text-xs">Decisão</Label>
            <Select value={decision} onValueChange={(v) => changeDecision(v as typeof decision)}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="aprovado"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Aprovado</span></SelectItem>
                <SelectItem value="recusado"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" /> Recusado</span></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-64 flex-1 space-y-1">
            <Label htmlFor="fa-dec" className="block text-xs">{reasonNeeded ? "Motivo da recusa (obrigatório)" : outcome === "recusada" ? "Motivo da recusa (opcional: os itens já têm motivo)" : "Observação (opcional)"}</Label>
            <Textarea id="fa-dec" rows={1} className="min-h-9" value={decNotes} onChange={(e) => setDecNotes(e.target.value)}
              onFocus={() => { notesStart.current = decNotes; }}
              onBlur={() => {
                const before = notesStart.current ?? "", after = decNotes;
                notesStart.current = null;
                if (before !== after) history.push({ label: "Observação da decisão", undo: () => setDecNotes(before), redo: () => setDecNotes(after) });
              }} />
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{faCount.approved} aprovados · {faCount.rejected} recusados · {faCount.pending} pendentes</span>
              {outcome && (
                <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", statusClass(outcome === "aprovada" ? "APROVADA" : outcome === "parcial" ? "APROVADA PARCIALMENTE" : "RECUSADA"))}>
                  {outcome === "aprovada" ? "APROVADA" : outcome === "parcial" ? "APROVADA PARCIALMENTE" : "RECUSADA"}
                </span>
              )}
            </div>
            <span title={!outcome ? "Decida todos os itens (ou escolha Aprovado/Recusado em Decisão)" : undefined}>
              <Button disabled={!outcome || decide.isPending || (reasonNeeded && !decNotes.trim())} onClick={() => decide.mutate()}>
                <Send className="h-4 w-4" /> Enviar ao Comprador
              </Button>
            </span>
          </div>
        </div>
      )}

      <FaBanner r={r} userName={userName} rule={rule} />
      {mode === "aprovacao" && partialWaiting && !mayDecide && (
        <p className="rounded-md bg-muted p-2 text-xs">Aguardando a aprovação do {r.fa_partial_side === "gestor" ? "nível Operacional" : "gestor da obra"}.</p>
      )}
      {!embedded && <ScHeaderCard r={r} clientName={clientName} />}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="block text-xs">Prioridade da melhor escolha</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Critérios">
            {CRITERIA.map((c) => {
              const on = criteria.includes(c.value);
              return (
                <button key={c.value} type="button" aria-pressed={on} title={c.hint} disabled={!editable || setCriteria.isPending}
                  onClick={() => {
                    const n = on ? criteria.filter((x) => x !== c.value) : [...criteria, c.value];
                    if (!n.length) { toast.info("Deixe ao menos um critério"); return; }
                    // Desligar o Valor pede confirmação (a escolha deixa de olhar o preço).
                    if (on && c.value === "valor") { setConfirmValor(n); return; }
                    applyCriteria(n);
                  }}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors disabled:cursor-default",
                    on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-muted")}>
                  {on && <Check className="h-3 w-3" />} {c.label}
                </button>
              );
            })}
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{readQuotes.length} {readQuotes.length === 1 ? "cotação lida" : "cotações lidas"} · {rec.covered} de {rec.rows.length} itens com cotação</span>
        <Popover>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className="ml-auto"><Columns3 className="h-4 w-4" /> Colunas</Button></PopoverTrigger>
          <PopoverContent className="w-56 space-y-1" align="end">
            {cols.filter((c) => !c.fixed).map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                <Checkbox checked={!hidden.has(c.key)} onCheckedChange={() => toggleCol(c.key)} /> {c.label}
              </label>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {visible.map((c) => <FilterHead key={c.key} column={c} rows={rowsForColumn(rec.rows, visible, filters, c.key)} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} />)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!shown.length && <TableRow><TableCell colSpan={visible.length} className="text-center text-muted-foreground">Nenhum item.</TableCell></TableRow>}
            {shown.map((x) => (
              <TableRow key={x.item.id}>
                {visible.map((c) => <TableCell key={c.key} className={c.className} title={c.key === "notes" ? full(x).notes ?? undefined : undefined}>{c.cell(x)}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={Math.max(1, totalIdx)} className="text-right">Total da melhor escolha</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums font-semibold">
                <span className="inline-flex items-center gap-1.5">{brl(rec.total)} <BudgetDot total={rec.total} budget={budget} /></span>
              </TableCell>
              <TableCell colSpan={Math.max(1, visible.length - totalIdx - 1)} className="text-xs text-muted-foreground">
                Verba da SC: {brl(budget)} · {budgetSignal(rec.total, budget).label}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {readQuotes.length > 0 && <QuotesTable data={d} />}

      {attach && <QuotesAttachDialog row={r} onClose={() => setAttach(false)} onDone={() => void invalidate()} />}
      {matching && <QuoteMatchingDialog data={d} onClose={() => setMatching(false)} onFinish={() => { setMatching(false); void invalidate(); }} />}

      <Dialog open={!!confirmValor} onOpenChange={(o) => !o && setConfirmValor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desativar o critério Valor?</DialogTitle>
            <DialogDescription>
              Sem o Valor, a melhor escolha de cada item deixa de considerar o preço e passa a olhar só {confirmValor?.map((k) => CRITERIA.find((c) => c.value === k)?.label.toLowerCase()).join(" e ")}. Pode sair mais caro. Deseja realmente desativar?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmValor(null)}>Manter o Valor</Button>
            <Button variant="destructive" onClick={() => { const n = confirmValor!; setConfirmValor(null); applyCriteria(n); }}>Desativar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!refuse} onOpenChange={(o) => { if (!o) setRefuse(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recusar o item {refuse?.no}</DialogTitle>
            <DialogDescription>{refuse?.desc}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="fa-item-reason" className="block">Justificativa da recusa <span className="text-destructive">*</span></Label>
            <Textarea id="fa-item-reason" rows={3} autoFocus value={refuseReason} onChange={(e) => setRefuseReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefuse(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={!refuseReason.trim() || itemDecide.isPending}
              onClick={() => refuse && itemDecide.mutate({ item: refuse.id, no: refuse.no, status: "RECUSADO", reason: refuseReason.trim(), before: refuse.before, beforeReason: refuse.beforeReason })}>
              Recusar item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={aiText != null} onOpenChange={(o) => { if (!o) setAiText(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" /> Resumo da IA · {r.number}</DialogTitle>
            <DialogDescription>Resumo geral da solicitação e da recomendação. Confira os valores na tabela antes de decidir.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm leading-relaxed">{aiText}</div>
          <DialogFooter>
            <Button variant="outline" disabled={aiSummary.isPending} onClick={() => aiSummary.mutate(aiContext())}>
              {aiSummary.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Gerar de novo
            </Button>
            <Button onClick={() => setAiText(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sending} onOpenChange={setSending}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Enviar ao Aprovador · {r.number}</DialogTitle>
            <DialogDescription>Prévia de como a SC vai para a aprovação. O status passa para EM APROVAÇÃO.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <th className="p-2 text-left">Item</th><th className="p-2 text-left">Descrição</th><th className="p-2 text-left">Fornecedor</th>
                  <th className="p-2 text-right">Unit.</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Verba</th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rec.rows.map((x) => (
                  <TableRow key={x.item.id}>
                    <TableCell>{x.item.item_no}</TableCell>
                    <TableCell>{x.item.quantity} {x.item.unit} · {x.item.description}</TableCell>
                    <TableCell>{x.chosen ? supplierOf(x) : <span className="text-destructive">sem cotação</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.chosen ? brl(x.chosen.unitPrice) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{x.chosen ? brl(x.chosen.total) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(x.item.budget)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted p-3 text-sm">
            <span>Total: <b>{brl(rec.total)}</b></span>
            <span className="inline-flex items-center gap-1.5">Verba: <b>{brl(budget)}</b> <BudgetDot total={rec.total} budget={budget} /></span>
            <span>Critérios: <b>{critLabel}</b></span>
            <span className="w-full text-xs text-muted-foreground">{RULE_LABEL[rule]}</span>
          </div>
          {overCount > 0 && <p className="text-xs text-red-600 dark:text-red-400">{overCount} item(ns) acima da própria verba: a aprovação segue a regra de acima da verba</p>}
          {rec.covered < rec.rows.length && <p className="text-xs text-amber-600">{rec.rows.length - rec.covered} item(ns) sem cotação vão sem fornecedor.</p>}
          <div className="space-y-1">
            <Label htmlFor="fa-notes">Observações para o aprovador</Label>
            <Textarea id="fa-notes" rows={3} value={sendNotes} onChange={(e) => setSendNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSending(false)}>Cancelar</Button>
            <Button disabled={send.isPending} onClick={() => send.mutate()}><Send className="h-4 w-4" /> Enviar ao Aprovador</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FaBanner({ r, userName, rule }: { r: RecData["req"]; userName: Map<string, string>; rule: FaRule }) {
  const when = (t: string | null) => (t ? new Date(t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
  if (r.fa_state === "em_aprovacao") {
    return (
      <div className="rounded-md border border-orange-500/40 bg-orange-500/10 p-3 text-sm">
        <b>Em aprovação</b> desde {when(r.fa_sent_at)}{r.fa_sent_by ? ` · enviada por ${userName.get(r.fa_sent_by) ?? "—"}` : ""} · total {brl(r.fa_total)} · verba {brl(r.fa_budget)}
        <div className="text-xs text-muted-foreground">{RULE_LABEL[rule]}</div>
        {r.fa_partial_side && (
          <div className="mt-1 text-xs"><b>Aprovação dupla:</b> aprovada por {userName.get(r.fa_partial_by ?? "") ?? "—"} ({r.fa_partial_side === "gestor" ? "gestor da obra" : "Operacional"}) em {when(r.fa_partial_at)} · falta o {r.fa_partial_side === "gestor" ? "nível Operacional" : "gestor da obra"}</div>
        )}
        {r.fa_notes && <div className="mt-1 text-xs"><b>Comprador:</b> {r.fa_notes}</div>}
      </div>
    );
  }
  if (r.fa_state === "aprovada" || r.fa_state === "recusada") {
    const ok = r.fa_state === "aprovada";
    const part = ok && r.status === "APROVADA PARCIALMENTE";
    return (
      <div className={cn("rounded-md border p-3 text-sm", part ? "border-indigo-500/40 bg-indigo-500/10" : ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10")}>
        <b>{part ? "Aprovada parcialmente" : ok ? "Aprovada" : "Recusada"}</b>{r.fa_decided_by ? ` por ${userName.get(r.fa_decided_by) ?? "—"}` : ""} em {when(r.fa_decided_at)}
        {part ? " · comprar só os itens aprovados." : ok ? " · comprar com os fornecedores escolhidos." : " · refaça a recomendação e envie de novo."}
        {r.fa_decision_notes && <div className="mt-1 text-xs"><b>{ok ? "Observação" : "Motivo"}:</b> {r.fa_decision_notes}</div>}
        {r.fa_ack_needed && <div className="mt-1 text-xs text-orange-600">Pendente a ciência do nível Executivo.</div>}
        {!r.fa_ack_needed && r.fa_ack_at && <div className="mt-1 text-xs text-muted-foreground">Ciência do Executivo em {when(r.fa_ack_at)}.</div>}
      </div>
    );
  }
  return null;
}

/** Resumo do item para o aprovador: quantas cotações, fornecedores (abrem o arquivo) e critérios usados. */
function ItemSummary({ row, quotesRead, criteria }: { row: RecRow; quotesRead: number; criteria: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Resumo das cotações deste item"><Info className="h-3.5 w-3.5" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-2 text-xs" align="end">
        <div className="font-medium">{row.item.item_no}. {row.item.description}</div>
        <div className="text-muted-foreground">{quotesRead} {quotesRead === 1 ? "cotação analisada" : "cotações analisadas"} · {row.options.length} com este item · critérios: {criteria}</div>
        {!row.options.length && <p className="text-muted-foreground">Nenhuma cotação tem este item.</p>}
        <ol className="space-y-1">
          {row.options.map((o, i) => (
            <li key={o.quoteItem.id} className={cn("flex items-center gap-2 rounded px-1 py-0.5", o === row.chosen && "bg-muted font-medium")}>
              <span className="w-5 text-muted-foreground">{i + 1}º</span>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-primary hover:underline" onClick={() => void openQuoteFile(o.quote.file_path)}>
                {o.quote.supplier ?? "Fornecedor sem nome"}
              </button>
              <span className="tabular-nums">{brl(o.total)}</span>
            </li>
          ))}
        </ol>
        {row.options.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {row.options.map((o) => `${o.quote.supplier ?? "—"}: entrega ${o.deliveryDays ?? "?"} d, pagamento ${o.quote.payment_terms ?? (o.paymentDays != null ? `${o.paymentDays} d` : "?")}`).join(" · ")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Cotações lidas da SC (fornecedor, condições e arquivo). */
function QuotesTable({ data }: { data: RecData }) {
  const read = data.quotes.filter((q) => q.read_status === "lido");
  return (
    <div className="panel overflow-x-auto">
      <div className="border-b border-border px-3 py-2 text-sm font-medium">Cotações</div>
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            {["Fornecedor", "Nº", "Pagamento", "Prazo pagto.", "Entrega", "Frete", "Total da cotação", "Itens", "Arquivo"].map((h) => <th key={h} className="p-2 text-left font-medium text-muted-foreground">{h}</th>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {read.map((q) => (
            <TableRow key={q.id}>
              <TableCell className="font-medium">{q.supplier ?? "—"}{q.source === "solicitante" && <span className="ml-1 text-muted-foreground">(solicitante)</span>}</TableCell>
              <TableCell>{q.quote_number ?? "—"}</TableCell>
              <TableCell>{q.payment_terms ?? "—"}</TableCell>
              <TableCell>{q.payment_days != null ? `${q.payment_days} d` : "—"}</TableCell>
              <TableCell>{q.delivery_days != null ? `${q.delivery_days} d` : "—"}</TableCell>
              <TableCell className="tabular-nums">{brl(q.freight)}</TableCell>
              <TableCell className="tabular-nums">{brl(q.total)}</TableCell>
              <TableCell>{data.qItems.filter((x) => x.quote_id === q.id && !x.discarded && x.request_item_id).length} de {data.qItems.filter((x) => x.quote_id === q.id).length}</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void openQuoteFile(q.file_path)}>
                  {/\.(pdf|xlsx?|xlsm|csv)$/i.test(q.file_name ?? q.file_path) ? <FileText className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} Abrir
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

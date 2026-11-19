import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Eye, FileSpreadsheet, FileText, ListChecks } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchSelect } from "@/components/search-select";
import { todayISO } from "@/components/compras/sc-shared";
import { SC_CATEGORIES, brDate } from "@/lib/purchase-requests";
import { buildScReport, SC_REPORT_COLUMNS, type ScReportItem, type ScReportParams, type ScReportRequest } from "@/lib/sc-report";

const SHOW_LABEL = { abertas: "Em aberto (itens pendentes)", concluidas: "Compradas/Encerradas", todas: "Todas" } as const;
const GROUP_LABEL = { nenhum: "Sem agrupamento", solicitante: "Solicitante", cliente: "Cliente", categoria: "Categoria" } as const;
const SORT_LABEL = { prazo_desc: "Prazo (decrescente)", prazo_asc: "Prazo (crescente)", natureza: "Natureza" } as const;

/** Comprador › botão "Relação de SCs": parâmetros, visualização, PDF (horizontal) e Excel; uma linha por item da SC. */
export function ScReportButton() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [p, setP] = useState<ScReportParams>({ from: "", to: "", show: "abertas", requester: "all", category: "all", system: "all", group: "nenhum", sort: "prazo_asc" });
  const set = <K extends keyof ScReportParams>(k: K, v: ScReportParams[K]) => setP((s) => ({ ...s, [k]: v }));

  const data = useQuery({
    queryKey: ["sc-report-data"],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const reqs = await fetchAll<ScReportRequest>((a, b) => supabase.from("purchase_requests")
        .select("id, number, request_date, requester_id, requester_name, system, category, nature, client_id, due_date, status, status_at, sent_at, work_id, cc_code")
        .in("stage", ["compras", "cancelada"]).order("request_date").range(a, b));
      const ids = reqs.map((r) => r.id);
      const items: ScReportItem[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase.from("purchase_request_items").select("request_id, item_no, quantity, unit, description, budget, work_id, cc_code, status").in("request_id", ids.slice(i, i + 200));
        if (error) throw error;
        items.push(...((data ?? []) as ScReportItem[]));
      }
      const [{ data: clients }, { data: works }, { data: users }] = await Promise.all([
        supabase.from("clients").select("id, name, cc_prefix"),
        supabase.from("works").select("id, name, cc_suffix, client_id"),
        supabase.from("users_profiles").select("id, full_name"),
      ]);
      return { reqs, items, clients: clients ?? [], works: works ?? [], users: users ?? [] };
    },
  });
  const ctx = useMemo(() => {
    const cl = new Map((data.data?.clients ?? []).map((c) => [c.id, c]));
    const wk = new Map((data.data?.works ?? []).map((w) => [w.id, w]));
    return {
      clientName: (id: string | null) => (id ? cl.get(id)?.name ?? "—" : "Sem cliente"),
      workName: (id: string | null) => (id ? wk.get(id)?.name ?? "—" : "Rateio geral"),
      ccOf: (clientId: string | null, workId: string | null) => {
        const pre = clientId ? cl.get(clientId)?.cc_prefix : null;
        if (!pre) return "—";
        if (!workId) return `${pre}999`;
        const suf = wk.get(workId)?.cc_suffix;
        return suf ? `${pre}${suf}` : "—";
      },
    };
  }, [data.data]);
  const requesters = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data.data?.reqs ?? []) if (!m.has(r.requester_id)) m.set(r.requester_id, (data.data?.users ?? []).find((u) => u.id === r.requester_id)?.full_name || r.requester_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [data.data]);
  const groups = useMemo(() => (data.data ? buildScReport(data.data.reqs, data.data.items, p, todayISO(), ctx) : []), [data.data, p, ctx]);
  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const subtitle = [
    `Emissão: ${p.from ? brDate(p.from) : "início"} a ${p.to ? brDate(p.to) : "hoje"}`, SHOW_LABEL[p.show],
    p.requester !== "all" ? `Solicitante: ${requesters.find(([id]) => id === p.requester)?.[1] ?? ""}` : "",
    p.category !== "all" ? `Categoria: ${p.category}` : "", p.system !== "all" ? `Tipo: ${p.system}` : "",
    p.group !== "nenhum" ? `Agrupado por ${GROUP_LABEL[p.group].toLowerCase()}` : "", `Ordem: ${SORT_LABEL[p.sort].toLowerCase()}`,
  ].filter(Boolean).join(" · ");
  const fileBase = `Relação de SCs ${todayISO().split("-").reverse().join("-")}`;

  const exportPdf = async () => {
    if (!total) { toast.error("Nenhuma linha com esses parâmetros"); return; }
    const { exportScReportPdf } = await import("@/lib/sc-report-pdf");
    await exportScReportPdf(groups, subtitle, `${fileBase}.pdf`);
  };
  const exportXlsx = async () => {
    if (!total) { toast.error("Nenhuma linha com esses parâmetros"); return; }
    const XLSX = await import("xlsx");
    const head = [...(p.group !== "nenhum" ? [GROUP_LABEL[p.group]] : []), ...SC_REPORT_COLUMNS.map((c) => c.label)];
    const body = groups.flatMap((g) => g.rows.map((r) => [...(p.group !== "nenhum" ? [g.group] : []), ...SC_REPORT_COLUMNS.map((c) => r[c.key] ?? "")]));
    const ws = XLSX.utils.aoa_to_sheet([["Relação de SCs"], [subtitle], [], head, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relação de SCs");
    XLSX.writeFile(wb, `${fileBase}.xlsx`);
  };

  const sel = <T extends string>(label: string, value: T, onChange: (v: T) => void, options: [string, string][]) => (
    <div className="space-y-1">
      <Label className="block">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-72">{options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );

  return (
    <>
      <Button variant="outline" onClick={() => { setOpen(true); setPreview(false); }}><ListChecks className="h-4 w-4" /> Relação de SCs</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={preview ? "flex max-h-[94vh] max-w-[96vw] flex-col" : "max-w-xl"}>
          <DialogHeader>
            {preview && (
              <Button variant="ghost" size="sm" className="absolute right-12 top-3" onClick={() => setPreview(false)}>
                <ArrowLeft className="h-4 w-4" /> Voltar aos parâmetros
              </Button>
            )}
            <DialogTitle>{preview ? "Relação de SCs" : "Relação de SCs · Parâmetros"}</DialogTitle>
            <DialogDescription>{preview ? `${subtitle} · ${total} linha(s)` : "Uma linha por item da SC (SC do TOTVS = uma linha). Em aberto lista os itens ainda pendentes."}</DialogDescription>
          </DialogHeader>
          {!preview ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="rel-from">Emissão de</Label><Input id="rel-from" type="date" value={p.from} onChange={(e) => set("from", e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="rel-to">Emissão até</Label><Input id="rel-to" type="date" value={p.to} onChange={(e) => set("to", e.target.value)} /></div>
              {sel("Mostrar", p.show, (v) => set("show", v), Object.entries(SHOW_LABEL))}
              <div className="space-y-1">
                <Label className="block">Solicitante</Label>
                <SearchSelect value={p.requester} onChange={(v) => set("requester", v)} searchPlaceholder="Digite o nome"
                  options={[{ value: "all", label: "Todos" }, ...requesters.map(([id, n]) => ({ value: id, label: n }))]} />
              </div>
              {sel("Categoria", p.category, (v) => set("category", v), [["all", "Todas"], ...SC_CATEGORIES.map((c) => [c, c] as [string, string])])}
              {sel("Tipo", p.system, (v) => set("system", v), [["all", "Todas"], ["PLANILHA", "Planilha"], ["TOTVS", "TOTVS"]])}
              {sel("Agrupamento", p.group, (v) => set("group", v), Object.entries(GROUP_LABEL))}
              {sel("Ordenar", p.sort, (v) => set("sort", v), Object.entries(SORT_LABEL))}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
              <Table className="text-[11px]">
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>{SC_REPORT_COLUMNS.map((c) => <TableHead key={c.key} className="whitespace-nowrap px-2">{c.label}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {!total && <TableRow><TableCell colSpan={SC_REPORT_COLUMNS.length} className="text-center text-muted-foreground">Nenhuma linha com esses parâmetros.</TableCell></TableRow>}
                  {groups.map((g) => (
                    <Fragment key={g.group || "_"}>
                      {g.group && <TableRow className="bg-muted/60 hover:bg-muted/60"><TableCell colSpan={SC_REPORT_COLUMNS.length} className="px-2 font-semibold">{g.group} ({g.rows.length})</TableCell></TableRow>}
                      {g.rows.map((r, i) => (
                        <TableRow key={`${r.number}-${r.item}-${i}`}>
                          {SC_REPORT_COLUMNS.map((c) => <TableCell key={c.key} className={`px-2 py-1 ${c.key === "description" || c.key === "costCenter" ? "min-w-40" : "whitespace-nowrap"}`}>{r[c.key]}</TableCell>)}
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <span />
            <div className="flex flex-wrap gap-2">
              {!preview && <Button variant="outline" disabled={data.isLoading} onClick={() => setPreview(true)}><Eye className="h-4 w-4" /> Visualizar</Button>}
              <Button variant="outline" disabled={data.isLoading} onClick={() => void exportPdf()}><FileText className="h-4 w-4" /> Exportar PDF</Button>
              <Button disabled={data.isLoading} onClick={() => void exportXlsx()}><FileSpreadsheet className="h-4 w-4" /> Baixar Excel</Button>
            </div>
          </DialogFooter>
          {data.isLoading && <p className="text-xs text-muted-foreground">Carregando as SCs…</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}

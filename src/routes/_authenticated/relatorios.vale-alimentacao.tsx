import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { computeVA, vaPaths, vaPeriod, type VALine, type VASettings } from "@/lib/vale-alimentacao";
import { loadVASheets } from "@/lib/va.functions";

export const Route = createFileRoute("/_authenticated/relatorios/vale-alimentacao")({
  head: () => ({ meta: [
    { title: "Vale Alimentação | AB5 Hub" },
    { name: "description", content: "Apuração do Vale Alimentação pelas planilhas de ponto: faltas, atestados, afastamentos e atrasos." },
    { property: "og:title", content: "Vale Alimentação | AB5 Hub" },
    { property: "og:description", content: "Relatório de controle do Vale Alimentação por competência." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: VAPage,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (d: string) => d.split("-").reverse().join("/");
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const defaultYm = () => { const d = new Date(); if (d.getDate() > 25) d.setMonth(d.getMonth() + 1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const DEFAULTS: VASettings = { base_value: 200, tolerance_min: 15, pct1: 50, pct2: 70, pct3: 100, unjustified_reasons: ["FALTA INJUSTIFICADA"], justified_reasons: ["ATESTADO MEDICO", "AFASTAMENTO"], abono_reasons: ["DECLARACAO DE HORAS", "ABONO"] };

function useSettings() {
  return useQuery({ queryKey: ["va-settings"], queryFn: async () => {
    const { data, error } = await (supabase as any).from("va_settings").select("*").eq("id", true).maybeSingle();
    if (error) throw error;
    return (data ? { ...DEFAULTS, ...data, base_value: Number(data.base_value), pct1: Number(data.pct1), pct2: Number(data.pct2), pct3: Number(data.pct3) } : DEFAULTS) as VASettings;
  } });
}

function VAPage() {
  return <div className="space-y-5"><PageHeader title="Vale Alimentação" description="Apuração pela planilha Justificativa e Atraso da competência (26 ao 25)." />
    <Tabs defaultValue="relatorio"><TabsList><TabsTrigger value="relatorio">Relatório</TabsTrigger><TabsTrigger value="regras">Regras e valores</TabsTrigger></TabsList>
      <TabsContent value="relatorio"><Report /></TabsContent><TabsContent value="regras"><Rules /></TabsContent></Tabs></div>;
}

function Report() {
  const [ym, setYm] = useState(defaultYm());
  const [detail, setDetail] = useState<{ line: VALine; kind: "injustificada" | "justificada" | "atraso" | "all" } | null>(null);
  const [q, setQ] = useState("");
  const load = useServerFn(loadVASheets);
  const settings = useSettings();
  const sheets = useQuery({ queryKey: ["va-sheets", ym], queryFn: () => load({ data: { ym } }), retry: false });
  const people = useQuery({ queryKey: ["va-people"], queryFn: async () => {
    const { data, error } = await supabase.from("collaborators").select("id, registration_number, full_name, contract_type").eq("status", "active").order("full_name");
    if (error) throw error;
    return (data ?? []).filter((c) => c.contract_type !== "pj").map((c) => ({ id: c.id, reg: c.registration_number ?? "", name: c.full_name }));
  } });
  const lines = useMemo(() => sheets.data?.found && settings.data && people.data ? computeVA(people.data, sheets.data.just, sheets.data.punches, settings.data) : [], [sheets.data, settings.data, people.data]);
  const shown = lines.filter((l) => `${l.reg} ${l.name}`.toLowerCase().includes(q.toLowerCase()));
  const per = vaPeriod(ym); const paths = vaPaths(ym);
  const total = lines.reduce((a, l) => a + l.value, 0);

  async function exportXlsx() {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Matrícula", "Nome", "Faltas Injustificadas", "Faltas Justificadas", "Atrasos", "Desconto %", "Valor VA"], ...lines.map((l) => [l.reg, l.name, l.unjust, l.just, l.late, l.pct, l.value])]), "Controle");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Data", "Matrícula", "Nome", "Tipo", "Motivo", "Detalhe"], ...lines.flatMap((l) => l.events.map((e) => [br(e.date), l.reg, l.name, e.kind === "atraso" ? "Atraso/Saída" : e.kind === "justificada" ? "Falta justificada" : "Falta injustificada", e.reason, e.detail]))]), "Ocorrências");
    XLSX.writeFile(wb, `Controle VA ${ym}.xlsx`);
  }

  const Cell = ({ l, k, n }: { l: VALine; k: "injustificada" | "justificada" | "atraso"; n: number }) =>
    n ? <button className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setDetail({ line: l, kind: k })}>{n}</button> : <span className="text-muted-foreground">0</span>;

  return <div className="space-y-4 pt-2">
    <div className="flex flex-wrap items-end gap-3">
      <div><Label htmlFor="va-ym">Competência</Label><Input id="va-ym" type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} className="w-44" /></div>
      <p className="pb-2 text-sm text-muted-foreground">{MONTHS[per.m - 1]}/{per.y}: {br(per.from)} a {br(per.to)}</p>
      <div className="min-w-48 flex-1"><Label htmlFor="va-q">Nome ou matrícula</Label><Input id="va-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" /></div>
      <Button variant="outline" onClick={exportXlsx} disabled={!lines.length}><Download className="h-4 w-4" />Exportar planilha</Button>
    </div>
    {sheets.isLoading && <p className="text-sm text-muted-foreground">Lendo as planilhas do mês…</p>}
    {sheets.error && <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{(sheets.error as Error).message}</div>}
    {sheets.data && !sheets.data.found && <div role="alert" className="rounded-md border border-border p-4 text-sm">
      <p className="font-medium">Relatório indisponível: planilha do mês não encontrada.</p>
      <p className="text-muted-foreground">Pasta esperada: {paths.folder}</p>
      <p className="text-muted-foreground">Faltando: {sheets.data.missing.join(", ")}</p>
    </div>}
    {sheets.data?.found && <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Colaboradores", lines.length], ["Recebem integral", lines.filter((l) => l.pct === 0).length], ["Com desconto", lines.filter((l) => l.pct > 0).length], ["Total a pagar", brl(total)]].map(([l, v]) => <div key={String(l)} className="rounded-md border border-border bg-card p-4"><p className="text-sm text-muted-foreground">{l}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{v}</p></div>)}</div>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["Matrícula", "Nome", "Faltas injustificadas", "Faltas justificadas", "Atrasos", "Desconto", "Valor VA"].map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{shown.map((l) => <TableRow key={l.id}><TableCell className="tabular-nums">{l.reg}</TableCell><TableCell className="min-w-64 font-medium">{l.events.length ? <button className="text-left hover:underline" onClick={() => setDetail({ line: l, kind: "all" })}>{l.name}</button> : l.name}</TableCell>
          <TableCell className="text-center"><Cell l={l} k="injustificada" n={l.unjust} /></TableCell><TableCell className="text-center"><Cell l={l} k="justificada" n={l.just} /></TableCell><TableCell className="text-center"><Cell l={l} k="atraso" n={l.late} /></TableCell>
          <TableCell className="tabular-nums">{l.pct}%</TableCell><TableCell className="text-right tabular-nums">{brl(l.value)}</TableCell></TableRow>)}
          {!shown.length && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhum colaborador encontrado</TableCell></TableRow>}</TableBody></Table></div>
    </>}
    <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{detail?.line.name}</DialogTitle><DialogDescription>Dias e horários que geraram a penalidade · desconto {detail?.line.pct}%</DialogDescription></DialogHeader>
      <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Motivo</TableHead><TableHead>Horários</TableHead></TableRow></TableHeader>
        <TableBody>{detail?.line.events.filter((e) => detail.kind === "all" || e.kind === detail.kind).map((e, i) => <TableRow key={i}><TableCell className="whitespace-nowrap">{br(e.date)}</TableCell><TableCell>{e.kind === "atraso" ? "Atraso/Saída" : e.kind === "justificada" ? "Justificada" : "Injustificada"}</TableCell><TableCell>{e.reason}</TableCell><TableCell className="text-xs text-muted-foreground">{e.kind === "atraso" ? e.detail : "—"}</TableCell></TableRow>)}</TableBody></Table>
    </DialogContent></Dialog>
  </div>;
}

function Rules() {
  const settings = useSettings(); const qc = useQueryClient();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const s = settings.data;
  const v = f ?? (s ? { base_value: String(s.base_value).replace(".", ","), tolerance_min: String(s.tolerance_min), pct1: String(s.pct1), pct2: String(s.pct2), pct3: String(s.pct3), unjustified_reasons: s.unjustified_reasons.join("\n"), justified_reasons: s.justified_reasons.join("\n"), abono_reasons: s.abono_reasons.join("\n") } : null);
  const save = useMutation({ mutationFn: async () => {
    if (!v) return;
    const num = (x: string) => { const n = Number(x.replace(",", ".")); if (isNaN(n) || n < 0) throw new Error("Valores inválidos"); return n; };
    const list = (x: string) => x.split("\n").map((t) => t.trim()).filter(Boolean);
    const { error } = await (supabase as any).from("va_settings").upsert({ id: true, base_value: num(v.base_value!), tolerance_min: Math.round(num(v.tolerance_min!)), pct1: num(v.pct1!), pct2: num(v.pct2!), pct3: num(v.pct3!), unjustified_reasons: list(v.unjustified_reasons!), justified_reasons: list(v.justified_reasons!), abono_reasons: list(v.abono_reasons!), updated_at: new Date().toISOString() });
    if (error) throw error;
  }, onSuccess: () => { toast.success("Regras salvas"); setF(null); qc.invalidateQueries({ queryKey: ["va-settings"] }); }, onError: (e: Error) => toast.error(e.message) });
  if (!v) return <p className="pt-4 text-sm text-muted-foreground">Carregando…</p>;
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...v, [k]: e.target.value });
  return <div className="max-w-3xl space-y-4 pt-2">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div><Label>Valor do VA (R$)</Label><Input value={v.base_value} onChange={set("base_value")} inputMode="decimal" /></div>
      <div><Label>Tolerância (min)</Label><Input value={v.tolerance_min} onChange={set("tolerance_min")} inputMode="numeric" /></div>
      <div><Label>1 ocorrência (%)</Label><Input value={v.pct1} onChange={set("pct1")} /></div>
      <div><Label>2 ocorrências (%)</Label><Input value={v.pct2} onChange={set("pct2")} /></div>
      <div><Label>3+ ocorrências (%)</Label><Input value={v.pct3} onChange={set("pct3")} /></div>
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      <div><Label>Faltas injustificadas (perde tudo)</Label><Textarea rows={5} value={v.unjustified_reasons} onChange={set("unjustified_reasons")} /></div>
      <div><Label>Faltas justificadas (1 por dia)</Label><Textarea rows={5} value={v.justified_reasons} onChange={set("justified_reasons")} /></div>
      <div><Label>Abonos (anulam atraso do dia)</Label><Textarea rows={5} value={v.abono_reasons} onChange={set("abono_reasons")} /></div>
    </div>
    <p className="text-xs text-muted-foreground">Um motivo por linha, como aparece na planilha Justificativa. Atrasos/saídas só contam em dias úteis, a partir da tolerância e com desconto no ponto.</p>
    <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="h-4 w-4" />Salvar regras</Button>
  </div>;
}

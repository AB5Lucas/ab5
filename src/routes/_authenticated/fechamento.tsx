import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { ArrowUpDown, ChevronLeft, ChevronRight, Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";
import { loadClosing, periodOf, type Adjustment, type ClosingRow } from "@/lib/closing";

export const Route = createFileRoute("/_authenticated/fechamento")({
  head: () => ({
    meta: [
      { title: "Premiações | AB5 Hub" },
      { name: "description", content: "Fechamento mensal de refeições, vale-transporte e prêmio viagem por colaborador." },
      { property: "og:title", content: "Premiações | AB5 Hub" },
      { property: "og:description", content: "Consolidação mensal de refeições, VT e prêmio viagem." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClosingPage,
});

const money = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const brFull = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const currentMonth = () => {
  const d = new Date();
  if (d.getDate() >= 26) d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const shift = (m: string, n: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
type SortKey = "reg" | "name" | "meals" | "vt" | "prize";
type Detail = { kind: "meals" | "vt" | "premio"; id: string } | null;

function ClosingPage() {
  const { canWrite } = useCurrentUser();
  const [month, setMonth] = useState(currentMonth());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const [detail, setDetail] = useState<Detail>(null);

  const data = useQuery({ queryKey: ["closing", month], queryFn: () => loadClosing(month) });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const rows = useMemo(() => {
    const raw = data.data ?? [];
    const inR = (d: string) => (!from || d >= from) && (!to || d <= to);
    const ranged = !!(from || to);
    return raw.filter((r) => !types.length || types.includes(r.contract ?? "efetivo")).map((r) => {
      if (!ranged) return r;
      const days = r.days.filter((d) => inR(d.date));
      const vtRows = r.vtRows.filter((v) => inR(v.date));
      const prizeRows = r.prizeRows.filter((p) => inR(p.date));
      const adjustments = r.adjustments.filter((a) => inR(a.entry_date));
      const fixed = r.vtAuto - r.vtRows.reduce((s, v) => s + v.value, 0);
      const vtAuto = vtRows.reduce((s, v) => s + v.value, 0) + (vtRows.some((v) => v.pays) ? fixed : 0);
      return {
        ...r, days, vtRows, prizeRows, adjustments, vtAuto,
        meals: days.filter((d) => d.counted).length,
        prizeAuto: prizeRows.reduce((s, p) => s + p.value, 0),
        vtManual: adjustments.filter((a) => a.kind === "vt").reduce((s, a) => s + Number(a.amount), 0),
        prizeManual: adjustments.filter((a) => a.kind === "premio").reduce((s, a) => s + Number(a.amount), 0),
      };
    }).filter((r) => !ranged || r.days.length || r.vtRows.length || r.adjustments.length);
  }, [data.data, from, to, types]);
  const vt = (r: ClosingRow) => r.vtAuto + r.vtManual;
  const prize = (r: ClosingRow) => r.prizeAuto + r.prizeManual;

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const f = rows.filter((r) => !s || r.name.toLowerCase().includes(s) || r.reg.toLowerCase().includes(s));
    const val = (r: ClosingRow) => ({ reg: r.reg, name: r.name, meals: r.meals, vt: vt(r), prize: prize(r) })[sort.key];
    return f.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "pt-BR", { numeric: true });
      return sort.asc ? c : -c;
    });
  }, [rows, q, sort]);

  const tot = list.reduce((t, r) => ({ meals: t.meals + r.meals, vt: t.vt + vt(r), prize: t.prize + prize(r) }), { meals: 0, vt: 0, prize: 0 });
  const current = detail ? rows.find((r) => r.id === detail.id) ?? null : null;
  const { start, end } = periodOf(month);
  const endIncl = new Date(end + "T12:00:00"); endIncl.setDate(endIncl.getDate() - 1);
  const endLabel = endIncl.toISOString().slice(0, 10);

  function exportXlsx() {
    const main = list.map((r) => ({ Matrícula: r.reg, "Nome completo": r.name, "Quantidade de refeição": r.meals, "Vale Transporte": vt(r), "Prêmio Viagem": prize(r) }));
    main.push({ Matrícula: "TOTAL", "Nome completo": "", "Quantidade de refeição": tot.meals, "Vale Transporte": tot.vt, "Prêmio Viagem": tot.prize });
    const det: Record<string, unknown>[] = [];
    for (const r of list) {
      const base = { Colaborador: r.name, Matrícula: r.reg };
      r.days.forEach((d) => det.push({ ...base, Data: brFull(d.date), Tipo: "Refeição", "Obra/descrição": d.work, "Valor automático": d.counted ? 1 : 0, "Valor manual": "", Observação: d.counted ? "Trabalhado" : d.reason }));
      r.vtRows.forEach((v) => det.push({ ...base, Data: brFull(v.date), Tipo: "Vale Transporte", "Obra/descrição": v.work, "Valor automático": v.value, "Valor manual": "", Observação: v.pays ? "" : "Sem VT" }));
      r.prizeRows.forEach((p) => det.push({ ...base, Data: brFull(p.date), Tipo: "Prêmio Viagem", "Obra/descrição": `${p.work} (${p.vehicle})`, "Valor automático": p.value, "Valor manual": "", Observação: `${p.distance} km` }));
      r.adjustments.forEach((a) => det.push({ ...base, Data: brFull(a.entry_date), Tipo: a.kind === "vt" ? "Vale Transporte (Manual)" : "Prêmio Viagem (Manual)", "Obra/descrição": a.description ?? "", "Valor automático": "", "Valor manual": Number(a.amount), Observação: a.notes ?? "" }));
    }
    const fmt = (rowsData: Record<string, unknown>[], isMoney: (k: string, r: Record<string, unknown>) => boolean) => {
      const ws = XLSX.utils.json_to_sheet(rowsData);
      const keys = Object.keys(rowsData[0] ?? {});
      ws["!cols"] = keys.map((k) => ({ wch: Math.min(80, Math.max(k.length, ...rowsData.map((r) => String(r[k] ?? "").length)) + 2) }));
      keys.forEach((k, c) => {
        for (let i = 1; i <= rowsData.length; i++) {
          if (!isMoney(k, rowsData[i - 1]!)) continue;
          const cell = ws[XLSX.utils.encode_cell({ r: i, c })];
          if (cell && cell.t === "n") cell.z = '"R$" #,##0.00';
        }
      });
      return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, fmt(main, (k) => k === "Vale Transporte" || k === "Prêmio Viagem"), "Fechamento");
    XLSX.utils.book_append_sheet(wb, fmt(det, (k, r) => k === "Valor manual" || (k === "Valor automático" && r["Tipo"] !== "Refeição")), "Detalhamento");
    XLSX.writeFile(wb, `Fechamento_${month.slice(5, 7)}-${month.slice(0, 4)}.xlsx`);
  }

  const head = (key: SortKey, label: string, right = false) => (
    <TableHead className={right ? "text-right" : ""}>
      <button className="inline-flex items-center gap-1" onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {label} <ArrowUpDown className="h-3 w-3" />
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Premiações" description={`Competência ${monthLabel(month)} — de ${brFull(start)} a ${brFull(endLabel)}.`} />
      <div className="panel flex flex-wrap items-end gap-3 p-3">
        <div className="flex items-end gap-1">
          <Button variant="outline" onClick={() => setMonth(shift(month, -1))}><ChevronLeft className="h-4 w-4" /> Anterior</Button>
          <div>
            <Label className="text-xs">Competência</Label>
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" />
          </div>
          <Button variant="outline" onClick={() => setMonth(shift(month, 1))}>Próximo <ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" min={start} max={endLabel} value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" min={start} max={endLabel} value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <div className="flex gap-1">
            {[["", "Toda MO"], ["efetivo", "Efetivos"], ["intermitente", "Intermitentes"], ["pj", "PJs"]].map(([k, l]) => {
              const on = k ? types.includes(k) : !types.length;
              return (
                <Button key={l} size="sm" variant={on ? "default" : "outline"}
                  onClick={() => setTypes(k ? (types.includes(k) ? types.filter((t) => t !== k) : [...types, k]) : [])}>{l}</Button>
              );
            })}
          </div>
        </div>
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por matrícula ou nome" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button onClick={exportXlsx} disabled={!list.length}><Download className="h-4 w-4" /> Exportar Planilha</Button>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {head("reg", "Matrícula")}
              {head("name", "Nome completo")}
              {head("meals", "Quantidade de refeição", true)}
              {head("vt", "Vale Transporte + Prêmio Motorista", true)}
              {head("prize", "Valor pago de Prêmio Viagem", true)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.isLoading && <TableRow><TableCell colSpan={5}>Carregando...</TableCell></TableRow>}
            {!data.isLoading && !list.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nenhum colaborador nesta competência.</TableCell></TableRow>}
            {list.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.reg}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right"><button className="underline-offset-2 hover:underline" onClick={() => setDetail({ kind: "meals", id: r.id })}>{r.meals}</button></TableCell>
                <TableCell className="text-right"><button className="underline-offset-2 hover:underline" onClick={() => setDetail({ kind: "vt", id: r.id })}>{money(vt(r))}</button></TableCell>
                <TableCell className="text-right"><button className="underline-offset-2 hover:underline" onClick={() => setDetail({ kind: "premio", id: r.id })}>{money(prize(r))}</button></TableCell>
              </TableRow>
            ))}
          </TableBody>
          {list.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-semibold">TOTAL</TableCell>
                <TableCell className="text-right font-semibold">{tot.meals}</TableCell>
                <TableCell className="text-right font-semibold">{money(tot.vt)}</TableCell>
                <TableCell className="text-right font-semibold">{money(tot.prize)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          {current && detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.kind === "meals" ? "Refeições" : detail.kind === "vt" ? "Vale Transporte" : "Prêmio Viagem"} — {current.name}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Competência: {monthLabel(month)}</p>
              {detail.kind === "meals" && <MealsDetail r={current} />}
              {detail.kind === "vt" && <VtDetail r={current} />}
              {detail.kind === "premio" && <PrizeDetail r={current} />}
              {detail.kind !== "meals" && (
                <ManualSection r={current} kind={detail.kind} month={month} canWrite={canWrite} auto={detail.kind === "vt" ? current.vtAuto : current.prizeAuto} />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MealsDetail({ r }: { r: ClosingRow }) {
  return (
    <>
      <Table>
        <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Obra</TableHead><TableHead>Situação</TableHead><TableHead>Contabilizado</TableHead></TableRow></TableHeader>
        <TableBody>
          {r.days.map((d) => (
            <TableRow key={d.date}>
              <TableCell>{br(d.date)}</TableCell><TableCell>{d.work}</TableCell><TableCell>{d.status}</TableCell>
              <TableCell>{d.counted ? "✓" : "Não"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm font-semibold">Total de refeições: {r.meals}</p>
    </>
  );
}

function VtDetail({ r }: { r: ClosingRow }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Obra</TableHead><TableHead>VT</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
      <TableBody>
        {r.vtRows.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Sem dias com VT.</TableCell></TableRow>}
        {r.vtRows.map((v, i) => (
          <TableRow key={i}><TableCell>{br(v.date)}</TableCell><TableCell>{v.work}</TableCell><TableCell>{v.pays ? "Sim" : "Não"}</TableCell><TableCell className="text-right">{money(v.value)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PrizeDetail({ r }: { r: ClosingRow }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Veículo</TableHead><TableHead>Obra</TableHead><TableHead className="text-right">Distância</TableHead><TableHead className="text-right">Prêmio</TableHead></TableRow></TableHeader>
      <TableBody>
        {r.prizeRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sem viagens com prêmio.</TableCell></TableRow>}
        {r.prizeRows.map((p, i) => (
          <TableRow key={i}><TableCell>{br(p.date)}</TableCell><TableCell>{p.vehicle}</TableCell><TableCell>{p.work}</TableCell><TableCell className="text-right">{p.distance.toLocaleString("pt-BR")} km</TableCell><TableCell className="text-right">{money(p.value)}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ManualSection({ r, kind, month, canWrite, auto }: { r: ClosingRow; kind: "vt" | "premio"; month: string; canWrite: boolean; auto: number }) {
  const qc = useQueryClient();
  const items = r.adjustments.filter((a) => a.kind === kind);
  const manual = items.reduce((s, a) => s + Number(a.amount), 0);
  const [edit, setEdit] = useState<Partial<Adjustment> | null>(null);
  const { start } = periodOf(month);
  const label = kind === "vt" ? "Vale Transporte" : "Prêmio Viagem";

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        collaborator_id: r.id, kind, entry_date: edit!.entry_date!, description: edit!.description || null,
        amount: Number(String(edit!.amount ?? 0).replace(",", ".")) || 0, notes: edit!.notes || null,
      };
      const res = edit!.id
        ? await supabase.from("closing_adjustments").update(payload).eq("id", edit!.id)
        : await supabase.from("closing_adjustments").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { toast.success("Lançamento salvo"); setEdit(null); qc.invalidateQueries({ queryKey: ["closing"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("closing_adjustments").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Lançamento excluído"); qc.invalidateQueries({ queryKey: ["closing"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-semibold uppercase tracking-wide">Lançamentos manuais</p>
        {canWrite && <Button size="sm" onClick={() => setEdit({ entry_date: start, amount: 0 })}><Plus className="h-4 w-4" /> Adicionar {label}</Button>}
      </div>
      {items.length > 0 && (
        <Table>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{br(a.entry_date)}</TableCell>
                <TableCell><Badge variant="secondary">Manual</Badge></TableCell>
                <TableCell>{a.description}{a.notes && <span className="block text-xs text-muted-foreground">{a.notes}</span>}</TableCell>
                <TableCell className="text-right">{money(Number(a.amount))}</TableCell>
                <TableCell className="w-20 text-right">
                  {canWrite && (
                    <>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => confirm("Excluir este lançamento?") && remove.mutate(a.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="grid gap-1 text-sm sm:grid-cols-3">
        <p><span className="text-muted-foreground">{kind === "vt" ? "VT" : "Prêmio"} automático:</span> {money(auto)}</p>
        <p><span className="text-muted-foreground">Ajustes manuais:</span> {money(manual)}</p>
        <p className="font-semibold">Total pago: {money(auto + manual)}</p>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Editar" : "Adicionar"} {label} (Manual)</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div><Label>Data</Label><Input type="date" value={edit.entry_date ?? ""} onChange={(e) => setEdit({ ...edit, entry_date: e.target.value })} /></div>
              <div><Label>{kind === "vt" ? "Obra ou descrição" : "Descrição"}</Label><Input value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              <div><Label>Valor (R$)</Label><Input value={String(edit.amount ?? "")} onChange={(e) => setEdit({ ...edit, amount: e.target.value as unknown as number })} /></div>
              <div><Label>Observação</Label><Textarea value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button disabled={!edit?.entry_date || save.isPending} onClick={() => save.mutate()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

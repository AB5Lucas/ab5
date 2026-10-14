import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";
import { monthEnd } from "@/lib/results-engine";

export const Route = createFileRoute("/_authenticated/fechamentos/suzano")({
  head: () => ({
    meta: [
      { title: "Pedidos | AB5 Hub" },
      { name: "description", content: "Pedidos, valores faturados e status por cliente." },
      { property: "og:title", content: "Pedidos | AB5 Hub" },
      { property: "og:description", content: "Status dos pedidos por cliente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuzanoPage,
});

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const br = (d: string) => d.split("-").reverse().join("/");
const n2 = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function useFilters() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [workId, setWorkId] = useState("");
  const [clientId, setClientId] = useState("");
  return { year, setYear, month, setMonth, workId, setWorkId, clientId, setClientId };
}

function SuzanoPage() {
  const f = useFilters();
  const works = useQuery({
    queryKey: ["suzano-works"],
    queryFn: async () => (await supabase.from("works").select("id, name, client_id, clients(name)").order("name")).data ?? [],
  });
  const ym = `${f.year}-${f.month.padStart(2, "0")}`;
  const start = `${ym}-01`;
  const end = monthEnd(ym);
  const clientOpts = [...new Map((works.data ?? []).filter((w: any) => w.clients?.name).map((w: any) => [w.client_id, w.clients.name] as [string, string])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const wid = f.workId === "all" ? "" : f.workId;
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - 3 + i));

  return (
    <div className="space-y-6">
      <PageHeader title="Pedidos" description="Pedidos e faturamentos do cliente selecionado." />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Ano</Label>
          <Select value={f.year} onValueChange={f.setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Mês</Label>
          <Select value={f.month} onValueChange={f.setMonth}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Cliente</Label>
          <Select value={f.clientId} onValueChange={(v) => { f.setClientId(v); f.setWorkId(""); }}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {clientOpts.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[280px]">
          <Label>Serviço</Label>
          <Select value={f.workId} onValueChange={f.setWorkId}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {(works.data ?? []).filter((w: any) => !f.clientId || f.clientId === "all" || w.client_id === f.clientId).map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.clients?.name ? `${w.clients.name} - ${w.name}` : w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Pedidos clientId={f.clientId} workId={wid} />
    </div>
  );
}


const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();

function Pedidos({ clientId, workId }: { clientId: string; workId: string }) {
  const q = useQuery({
    queryKey: ["orders-all-v3"],
    queryFn: async () => {
      const { data: ws } = await supabase.from("works").select("id, name, orders, client_id, clients(name)");
      const ids = (ws ?? []).map((w: any) => w.id);
      const fat = ids.length ? (await supabase.from("work_entries").select("work_id, description, amount, entry_date").eq("category", "faturamento").in("work_id", ids)).data ?? [] : [];
      // Pedidos com o mesmo número viram uma linha só: valores somados e meses listados
      const groups: Map<string, { key: string; num: string; client: string; clientId: string; number: string; works: Set<string>; workIds: Set<string>; dates: string[]; total: number; billed: number }> = new Map();
      for (const w of ((ws ?? []) as any[])) {
        for (const [i, o] of ((Array.isArray(w.orders) ? w.orders : []) as any[]).entries()) {
          const num = String(o.number ?? "").trim();
          const k = `${w.client_id}|${num ? norm(num) : `${w.id}-${i}`}`;
          const g = groups.get(k) ?? { key: k, num: norm(num), client: w.clients?.name ?? "—", clientId: w.client_id, number: num || "—", works: new Set<string>(), workIds: new Set<string>(), dates: [] as string[], total: 0, billed: 0 };
          g.works.add(w.name); g.workIds.add(w.id);
          if (o.date) g.dates.push(o.date);
          g.total += Number(o.value ?? 0);
          groups.set(k, g);
        }
      }
      const rows = [...groups.values()].map((g) => {
        const hits = g.number !== "—" ? fat.filter((e: any) => g.workIds.has(e.work_id) && norm(e.description ?? "").includes(g.num)) : [];
        const dates = g.dates.length ? g.dates : hits.map((e: any) => e.entry_date as string).slice(0, 1);
        const months = [...new Set(dates.map((d) => d.slice(0, 7)))].sort();
        return { key: g.key, client: g.client, clientId: g.clientId, number: g.number, work: [...g.works].join(", "), workIds: [...g.workIds], date: months[0] ?? "", months, total: g.total, billed: hits.reduce((a: number, e: any) => a + Number(e.amount), 0) };
      });
      return rows.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    },
  });
  const mon1 = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]}/${d.slice(0, 4)}`;
  const mon = (ms?: string[]) => (ms?.length ? ms.map(mon1).join(", ") : "—");
  const qc = useQueryClient();
  const [fNum, setFNum] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fSt, setFSt] = useState("all");
  const { canWrite } = useCurrentUser();
  const [sel, setSel] = useState<any>(null);
  const [fd, setFd] = useState({ date: new Date().toISOString().slice(0, 10), amount: "", workId: "" });
  const save = useMutation({
    mutationFn: async () => {
      const amount = Number(fd.amount.replace(/\./g, "").replace(",", "."));
      if (fd.amount.trim() === "" || isNaN(amount)) throw new Error("Informe o valor");
      if (!fd.date) throw new Error("Informe a data");
      const { error } = await supabase.from("work_entries").insert({
        work_id: fd.workId || sel.workIds[0], entry_date: fd.date, category: "faturamento",
        description: `Pedido ${sel.number}`, amount,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Faturamento lançado"); setSel(null); qc.invalidateQueries({ queryKey: ["orders-all-v3"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <div className="panel overflow-x-auto">
      <div className="flex flex-wrap items-end gap-3 p-3">
        <div><Label>Nº do pedido</Label><input className="flex h-9 w-48 rounded-md border border-input bg-background px-3 text-sm" value={fNum} onChange={(e) => setFNum(e.target.value)} placeholder="Buscar" /></div>
        <div><Label>Mês</Label><input type="month" className="flex h-9 w-44 rounded-md border border-input bg-background px-3 text-sm" value={fMonth} onChange={(e) => setFMonth(e.target.value)} /></div>
        <div>
          <Label>Status</Label>
          <Select value={fSt} onValueChange={setFSt}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem><SelectItem value="Em aberto">Em aberto</SelectItem>
              <SelectItem value="Parcial">Parcial</SelectItem><SelectItem value="Faturado">Faturado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(fNum || fMonth || fSt !== "all") && <Button variant="ghost" onClick={() => { setFNum(""); setFMonth(""); setFSt("all"); }}>Limpar</Button>}
      </div>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Lançar faturamento – Pedido {sel?.number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {sel?.workIds.length > 1 && (
              <div>
                <Label>Serviço</Label>
                <Select value={fd.workId || sel.workIds[0]} onValueChange={(v) => setFd({ ...fd, workId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{sel.workIds.map((id: string, i: number) => <SelectItem key={id} value={id}>{sel.work.split(", ")[i] ?? id}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Data</Label><input type="date" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={fd.date} onChange={(e) => setFd({ ...fd, date: e.target.value })} /></div>
            <div><Label>Valor (R$)</Label><input inputMode="decimal" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={fd.amount} onChange={(e) => setFd({ ...fd, amount: e.target.value })} placeholder="0,00" /></div>
            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pedido</TableHead><TableHead>Cliente</TableHead><TableHead>Serviço</TableHead><TableHead>Mês</TableHead>
            <TableHead className="text-right">Valor total</TableHead><TableHead className="text-right">Valor faturado</TableHead>
            <TableHead className="text-right">% Faturado</TableHead><TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.isLoading && <TableRow><TableCell colSpan={8}>Carregando...</TableCell></TableRow>}
          {!q.isLoading && !q.data?.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Nenhum pedido encontrado.</TableCell></TableRow>}
          {(q.data ?? []).filter((r) => {
            const p = r.total ? (r.billed / r.total) * 100 : 0;
            const st = r.billed <= 0 ? "Em aberto" : p >= 99.995 ? "Faturado" : "Parcial";
            return (!fNum || norm(r.number).includes(norm(fNum))) && (!fMonth || r.months.includes(fMonth)) && (fSt === "all" || st === fSt) && (!clientId || clientId === "all" || r.clientId === clientId) && (!workId || r.workIds.includes(workId));
          }).map((r) => {
            const p = r.total ? (r.billed / r.total) * 100 : 0;
            const st = r.billed <= 0 ? "Em aberto" : p >= 99.995 ? "Faturado" : "Parcial";
            return (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{r.number}</TableCell>
                <TableCell>{r.client}</TableCell>
                <TableCell>{r.work}</TableCell>
                <TableCell>{mon(r.months)}</TableCell>
                <TableCell className="text-right">{brl(r.total)}</TableCell>
                <TableCell className="text-right">
                  {canWrite ? (
                    <button type="button" className="underline decoration-dotted hover:text-primary" onClick={() => { setFd({ date: new Date().toISOString().slice(0, 10), amount: "", workId: "" }); setSel(r); }}>{brl(r.billed)}</button>
                  ) : brl(r.billed)}
                </TableCell>
                <TableCell className="text-right">{n2(p)}%</TableCell>
                <TableCell className={st === "Faturado" ? "text-primary" : st === "Em aberto" ? "text-destructive" : ""}>{st}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

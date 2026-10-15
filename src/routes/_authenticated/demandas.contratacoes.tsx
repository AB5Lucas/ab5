import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/demandas/contratacoes")({
  head: () => ({
    meta: [
      { title: "Contratações | AB5 Hub" },
      { name: "description", content: "Solicitações de contratação, andamento pelo RH e e-mails por cliente." },
      { property: "og:title", content: "Contratações | AB5 Hub" },
      { property: "og:description", content: "Acompanhamento das solicitações de contratação." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HiringPage,
});

export const STATUS: Record<string, string> = {
  aberta: "Solicitação aberta",
  analise: "Em análise pelo RH",
  aguardando: "Aguardando informações",
  processo: "Em processo de contratação",
  parcial: "Atendida parcialmente",
  atendida: "Atendida",
  cancelada: "Cancelada",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  aberta: "outline", analise: "secondary", aguardando: "secondary", processo: "default",
  parcial: "default", atendida: "default", cancelada: "destructive",
};
const PRIORITY: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };
const PRIO_ORDER: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
const EMAIL_RESULT: Record<string, string> = {
  pendente: "Pendente", enviado: "Enviado", falha: "Falha", sem_destinatarios: "Sem destinatários",
};
const num = (n: number) => `#${String(n).padStart(6, "0")}`;
const dt = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALL = "__all";

type Req = {
  id: string; number: number; created_at: string; updated_at: string; requester_id: string;
  requester_name: string | null; client_id: string; work_id: string; position_id: string | null;
  position_name: string; quantity: number; filled: number; reason: string; desired_date: string | null;
  priority: string; notes: string | null; status: string; rh_owner_id: string | null; rh_owner_name: string | null;
};

function useBase() {
  const clients = useQuery({
    queryKey: ["hr-clients"],
    queryFn: async () => (await supabase.from("clients").select("id,name").eq("active", true).order("name")).data ?? [],
  });
  const works = useQuery({
    queryKey: ["hr-works"],
    queryFn: async () => (await supabase.from("works").select("id,name,client_id").eq("active", true).order("name")).data ?? [],
  });
  const positions = useQuery({
    queryKey: ["hr-positions-base"],
    queryFn: async () => {
      const rows = (await supabase.from("positions").select("id,name").eq("active", true).order("name")).data ?? [];
      // só a função principal, sem nível (Ajudante N1..N4 → Ajudante)
      const seen = new Map<string, { id: string; name: string }>();
      for (const r of rows) {
        const base = r.name.replace(/\s+N\d+\s*$/i, "").trim();
        if (!seen.has(base.toLowerCase())) seen.set(base.toLowerCase(), { id: r.id, name: base });
      }
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    },
  });
  return { clients: clients.data ?? [], works: works.data ?? [], positions: positions.data ?? [] };
}

function HiringPage() {
  const { role } = useCurrentUser();
  const isRh = role === "admin" || role === "programmer";
  return (
    <div className="space-y-4">
      <PageHeader title="Contratações" description="Solicitações de contratação e acompanhamento pelo RH." />
      <Tabs defaultValue="req">
        <TabsList>
          <TabsTrigger value="req">Solicitações</TabsTrigger>
          {isRh && <TabsTrigger value="mail">Configuração de E-mails</TabsTrigger>}
        </TabsList>
        <TabsContent value="req"><Requests isRh={isRh} /></TabsContent>
        {isRh && <TabsContent value="mail"><EmailConfig /></TabsContent>}
      </Tabs>
    </div>
  );
}

function Requests({ isRh }: { isRh: boolean }) {
  const base = useBase();
  const reqs = useQuery({
    queryKey: ["hiring-requests"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hiring_requests").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });
  const [f, setF] = useState({ q: "", client: ALL, work: ALL, position: ALL, requester: ALL, owner: ALL, status: ALL, from: "", to: "", sort: "date" });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Req | null>(null);
  const cName = (id: string) => base.clients.find((c) => c.id === id)?.name ?? "—";
  const wName = (id: string) => base.works.find((w) => w.id === id)?.name ?? "—";
  const all = reqs.data ?? [];
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();

  const rows = useMemo(() => {
    const r = all.filter((x) =>
      (!f.q || num(x.number).includes(f.q.replace(/\D/g, "")) || String(x.number).includes(f.q.replace(/\D/g, ""))) &&
      (f.client === ALL || x.client_id === f.client) &&
      (f.work === ALL || x.work_id === f.work) &&
      (f.position === ALL || x.position_name === f.position) &&
      (f.requester === ALL || x.requester_name === f.requester) &&
      (f.owner === ALL || x.rh_owner_name === f.owner) &&
      (f.status === ALL || x.status === f.status) &&
      (!f.from || x.created_at.slice(0, 10) >= f.from) &&
      (!f.to || x.created_at.slice(0, 10) <= f.to));
    if (f.sort === "prio") r.sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9));
    if (f.sort === "status") r.sort((a, b) => Object.keys(STATUS).indexOf(a.status) - Object.keys(STATUS).indexOf(b.status));
    return r;
  }, [all, f]);

  const count = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  const cards = [
    ["Abertas", count(["aberta"])],
    ["Em andamento", count(["analise", "processo", "parcial"])],
    ["Aguardando informações", count(["aguardando"])],
    ["Atendidas", count(["atendida"])],
    ["Canceladas", count(["cancelada"])],
  ] as const;
  const sel = (k: keyof typeof f, label: string, opts: { v: string; l: string }[]) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={f[k]} onValueChange={(v) => setF({ ...f, [k]: v })}>
        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {opts.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(([l, n]) => (
          <div key={l} className="panel p-3">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="font-display text-2xl font-semibold">{n}</p>
          </div>
        ))}
      </div>
      <div className="panel grid grid-cols-2 gap-2 p-3 md:grid-cols-6">
        <div className="space-y-1"><Label className="text-xs">Nº</Label><Input className="h-8" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="000123" /></div>
        {sel("client", "Cliente", base.clients.map((c) => ({ v: c.id, l: c.name })))}
        {sel("work", "Serviço", base.works.filter((w) => f.client === ALL || w.client_id === f.client).map((w) => ({ v: w.id, l: w.name })))}
        {sel("position", "Função", uniq(all.map((r) => r.position_name)).map((v) => ({ v, l: v })))}
        {sel("requester", "Solicitante", uniq(all.map((r) => r.requester_name)).map((v) => ({ v, l: v })))}
        {sel("owner", "Responsável RH", uniq(all.map((r) => r.rh_owner_name)).map((v) => ({ v, l: v })))}
        {sel("status", "Status", Object.entries(STATUS).map(([v, l]) => ({ v, l })))}
        <div className="space-y-1"><Label className="text-xs">De</Label><Input type="date" className="h-8" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="space-y-1"><Label className="text-xs">Até</Label><Input type="date" className="h-8" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div className="space-y-1">
          <Label className="text-xs">Ordenar</Label>
          <Select value={f.sort} onValueChange={(v) => setF({ ...f, sort: v })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="date">Data</SelectItem><SelectItem value="prio">Prioridade</SelectItem><SelectItem value="status">Status</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex items-end justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setF({ q: "", client: ALL, work: ALL, position: ALL, requester: ALL, owner: ALL, status: ALL, from: "", to: "", sort: "date" })}>Limpar</Button>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />Nova solicitação</Button>
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Nº</TableHead><TableHead>Abertura</TableHead><TableHead>Cliente</TableHead><TableHead>Serviço</TableHead>
            <TableHead>Função</TableHead><TableHead>Vagas</TableHead><TableHead>Prioridade</TableHead><TableHead>Solicitante</TableHead>
            <TableHead>Responsável RH</TableHead><TableHead>Status</TableHead><TableHead>Atualizado</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                <TableCell className="font-mono">{num(r.number)}</TableCell>
                <TableCell>{dt(r.created_at)}</TableCell>
                <TableCell>{cName(r.client_id)}</TableCell>
                <TableCell>{wName(r.work_id)}</TableCell>
                <TableCell>{r.position_name}</TableCell>
                <TableCell>{r.filled}/{r.quantity}</TableCell>
                <TableCell>{PRIORITY[r.priority]}</TableCell>
                <TableCell>{r.requester_name ?? "—"}</TableCell>
                <TableCell>{r.rh_owner_name ?? "—"}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[r.status]}>{STATUS[r.status]}</Badge></TableCell>
                <TableCell>{dt(r.updated_at)}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Nenhuma solicitação.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {creating && <NewRequest onClose={() => setCreating(false)} />}
      {open && <Detail req={all.find((r) => r.id === open.id) ?? open} isRh={isRh} onClose={() => setOpen(null)} cName={cName} wName={wName} />}
    </div>
  );
}

function NewRequest({ onClose }: { onClose: () => void }) {
  const base = useBase();
  const qc = useQueryClient();
  const { user, profile } = useCurrentUser();
  const [v, setV] = useState({ client: "", work: "", reason: "", priority: "normal", notes: "" });
  const [lines, setLines] = useState([{ position: "", quantity: "1", custom: "" }]);
  const last = useQuery({
    queryKey: ["hiring-last-number"],
    queryFn: async () => (await supabase.from("hiring_requests").select("number").order("number", { ascending: false }).limit(1)).data?.[0]?.number ?? 0,
  });
  const nextNum = last.data != null ? last.data + 1 : null;
  const save = useMutation({
    mutationFn: async () => {
      const items = lines.map((l) => ({ pos: l.position === "__manual" ? (l.custom.trim() ? { id: null as string | null, name: l.custom.trim() } : undefined) : base.positions.find((p) => p.id === l.position), qty: parseInt(l.quantity, 10) }));
      if (!v.client || !v.work || !v.reason.trim() || items.some((i) => !i.pos || !(i.qty > 0)))
        throw new Error("Preencha cliente, serviço, justificativa e função/vagas de cada linha.");
      if (new Set(items.map((i) => i.pos!.name.toLowerCase())).size !== items.length) throw new Error("Função repetida: junte as vagas na mesma linha.");
      const name = profile?.full_name || user?.email || null;
      const nums: number[] = [];
      for (const i of items) {
        const { data, error } = await supabase.from("hiring_requests").insert({
          requester_id: user!.id, requester_name: name, client_id: v.client, work_id: v.work,
          position_id: i.pos!.id, position_name: i.pos!.name, quantity: i.qty, reason: v.reason.trim(),
          priority: v.priority, notes: v.notes.trim() || null,
        }).select("id,number").single();
        if (error) throw error;
        const ev = await supabase.from("hiring_request_events").insert({
          request_id: data.id, user_id: user!.id, user_name: name, event: "abertura", new_status: "aberta", note: v.notes.trim() || null,
        });
        if (ev.error) throw ev.error;
        nums.push(data.number);
      }
      return nums;
    },
    onSuccess: (n) => {
      toast.success(n.length > 1 ? `Solicitações ${n.map(num).join(", ")} abertas.` : `Solicitação ${num(n[0]!)} aberta.`);
      qc.invalidateQueries({ queryKey: ["hiring-requests"] });
      qc.invalidateQueries({ queryKey: ["hiring-last-number"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova solicitação de contratação</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Nº da solicitação</Label><Input disabled value={nextNum ? (lines.length > 1 ? `${num(nextNum)} a ${num(nextNum + lines.length - 1)}` : num(nextNum)) : "Automático"} /></div>
          <div className="space-y-1"><Label>Data da solicitação</Label><Input disabled value={new Date().toLocaleDateString("pt-BR")} /></div>
          <div className="col-span-2 space-y-1"><Label>Cliente *</Label>
            <Select value={v.client} onValueChange={(c) => setV({ ...v, client: c, work: "" })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{base.clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="col-span-2 space-y-1"><Label>Serviço *</Label>
            <Select value={v.work} onValueChange={(w) => setV({ ...v, work: w })} disabled={!v.client}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{base.works.filter((w) => w.client_id === v.client).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="col-span-2 space-y-2">
            <div className="grid grid-cols-[1fr_90px_32px] gap-2 text-sm font-medium"><span>Função *</span><span>Vagas *</span><span /></div>
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_90px_32px] gap-2">
                <Select value={l.position} onValueChange={(p) => setLines(lines.map((x, j) => (j === idx ? { ...x, position: p } : x)))}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__manual">Outra (digitar)</SelectItem>
                    {base.positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== idx))}><Trash2 className="h-4 w-4" /></Button>
                {l.position === "__manual" && (
                  <Input className="col-span-2" placeholder="Digite a função" value={l.custom} onChange={(e) => setLines(lines.map((x, j) => (j === idx ? { ...x, custom: e.target.value } : x)))} />
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { position: "", quantity: "1", custom: "" }])}><Plus className="mr-1 h-4 w-4" />Adicionar função</Button>
            {lines.length > 1 && <p className="text-xs text-muted-foreground">Cada função vira uma solicitação separada.</p>}
          </div>
          <div className="col-span-2 space-y-1"><Label>Prioridade</Label>
            <Select value={v.priority} onValueChange={(p) => setV({ ...v, priority: p })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PRIORITY).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="col-span-2 space-y-1"><Label>Justificativa *</Label><Textarea value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></div>
          <div className="col-span-2 space-y-1"><Label>Observações</Label><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Abrir solicitação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ req, isRh, onClose, cName, wName }: { req: Req; isRh: boolean; onClose: () => void; cName: (id: string) => string; wName: (id: string) => string }) {
  const qc = useQueryClient();
  const { user, profile } = useCurrentUser();
  const events = useQuery({
    queryKey: ["hiring-events", req.id],
    queryFn: async () => (await supabase.from("hiring_request_events").select("*").eq("request_id", req.id).order("created_at")).data ?? [],
  });
  const mails = useQuery({
    queryKey: ["hiring-mails", req.id],
    queryFn: async () => (await supabase.from("hiring_email_log").select("*").eq("request_id", req.id).order("created_at")).data ?? [],
  });
  const [status, setStatus] = useState(req.status);
  const [filled, setFilled] = useState(String(req.filled));
  const [note, setNote] = useState("");
  const [exception, setException] = useState(false);
  const [assume, setAssume] = useState(false);
  const closed = req.status === "cancelada" || req.status === "atendida";

  const save = useMutation({
    mutationFn: async () => {
      const n = Math.max(0, parseInt(filled, 10) || 0);
      if (n > req.quantity) throw new Error("Vagas atendidas maior que o solicitado.");
      if (status === "cancelada" && !note.trim()) throw new Error("Informe a justificativa do cancelamento.");
      if (status === "atendida" && n < req.quantity && !(exception && note.trim()))
        throw new Error("Atendida exige todas as vagas, ou marque exceção autorizada com justificativa.");
      if (status === "parcial" && (n <= 0 || n >= req.quantity)) throw new Error("Atendimento parcial: informe vagas atendidas entre 1 e " + (req.quantity - 1) + ".");
      if (status === req.status && n === req.filled && !note.trim() && !assume) throw new Error("Nada para atualizar.");
      const name = profile?.full_name || user?.email || null;
      const patch = { status, filled: n, updated_at: new Date().toISOString(), ...(assume ? { rh_owner_id: user!.id, rh_owner_name: name } : {}) };
      const { error } = await supabase.from("hiring_requests").update(patch).eq("id", req.id).eq("updated_at", req.updated_at).select("id").single();
      if (error) throw new Error("A solicitação foi alterada por outra pessoa. Reabra e tente de novo.");
      const ev = await supabase.from("hiring_request_events").insert({
        request_id: req.id, user_id: user!.id, user_name: name,
        event: status !== req.status ? "status" : "observacao",
        old_status: req.status, new_status: status, filled: n,
        note: [exception && status === "atendida" && n < req.quantity ? "[Exceção autorizada]" : "", note.trim()].filter(Boolean).join(" ") || null,
      });
      if (ev.error) throw ev.error;
    },
    onSuccess: () => {
      toast.success("Solicitação atualizada.");
      setNote(""); setAssume(false); setException(false);
      qc.invalidateQueries({ queryKey: ["hiring-requests"] });
      qc.invalidateQueries({ queryKey: ["hiring-events", req.id] });
      qc.invalidateQueries({ queryKey: ["hiring-mails", req.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const info: [string, React.ReactNode][] = [
    ["Abertura", dt(req.created_at)], ["Solicitante", req.requester_name ?? "—"],
    ["Cliente", cName(req.client_id)], ["Serviço", wName(req.work_id)],
    ["Função", req.position_name], ["Vagas", `${req.filled} atendidas de ${req.quantity} (${req.quantity - req.filled} pendentes)`],
    ["Prioridade", PRIORITY[req.priority]],
    ["Responsável RH", req.rh_owner_name ?? "—"], ["Status", <Badge key="s" variant={STATUS_VARIANT[req.status]}>{STATUS[req.status]}</Badge>],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>Contratação {num(req.number)}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {info.map(([k, val]) => <div key={k}><span className="text-muted-foreground">{k}: </span>{val}</div>)}
          <div className="col-span-2"><span className="text-muted-foreground">Justificativa: </span>{req.reason}</div>
          {req.notes && <div className="col-span-2"><span className="text-muted-foreground">Observações: </span>{req.notes}</div>}
        </div>

        {isRh && !closed && (
          <div className="panel space-y-3 p-3">
            <p className="font-display text-sm uppercase tracking-wide">Atualizar (RH)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(STATUS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1"><Label>Vagas atendidas</Label><Input type="number" min={0} max={req.quantity} value={filled} onChange={(e) => setFilled(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label>Observação {status === "cancelada" && "*"}</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><Checkbox checked={assume} onCheckedChange={(c) => setAssume(!!c)} />Assumir como responsável</label>
              {status === "atendida" && <label className="flex items-center gap-2"><Checkbox checked={exception} onCheckedChange={(c) => setException(!!c)} />Exceção autorizada (vagas incompletas)</label>}
              <Button className="ml-auto" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="font-display text-sm uppercase tracking-wide">Histórico</p>
          {(events.data ?? []).map((e) => (
            <div key={e.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="text-xs text-muted-foreground">{dt(e.created_at)} · {e.user_name ?? "—"}</p>
              <p>{e.event === "abertura" ? "Solicitação aberta" : e.old_status !== e.new_status ? `${STATUS[e.old_status ?? ""] ?? "—"} → ${STATUS[e.new_status ?? ""] ?? "—"}` : "Observação"}{e.filled != null && e.event !== "abertura" ? ` · ${e.filled} vaga(s) atendida(s)` : ""}</p>
              {e.note && <p className="text-muted-foreground">{e.note}</p>}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="font-display text-sm uppercase tracking-wide">E-mails</p>
          {(mails.data ?? []).map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{dt(m.created_at)}</span>
              <Badge variant={m.result === "enviado" ? "default" : m.result === "pendente" ? "secondary" : "destructive"}>{EMAIL_RESULT[m.result]}</Badge>
              <span>{m.to_emails.join(", ") || "—"}{m.cc_emails.length ? ` (CC: ${m.cc_emails.join(", ")})` : ""}</span>
              {m.error && <span className="text-xs text-muted-foreground">{m.error}</span>}
            </div>
          ))}
          {!mails.data?.length && <p className="text-sm text-muted-foreground">Nenhum registro.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmailConfig() {
  const base = useBase();
  const qc = useQueryClient();
  const configs = useQuery({
    queryKey: ["hiring-mail-cfg"],
    queryFn: async () => (await supabase.from("hiring_email_configs").select("*")).data ?? [],
  });
  const [client, setClient] = useState("");
  const cur = configs.data?.find((c) => c.client_id === client);
  const [v, setV] = useState({ to: "", cc: "", active: true, notes: "" });
  const pick = (id: string) => {
    setClient(id);
    const c = configs.data?.find((x) => x.client_id === id);
    setV({ to: c?.to_emails.join(", ") ?? "", cc: c?.cc_emails.join(", ") ?? "", active: c?.active ?? true, notes: c?.notes ?? "" });
  };
  const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const save = useMutation({
    mutationFn: async () => {
      const to = split(v.to), cc = split(v.cc);
      const bad = [...to, ...cc].filter((e) => !EMAIL_RE.test(e));
      if (bad.length) throw new Error(`E-mail inválido: ${bad.join(", ")}`);
      const row = { client_id: client, to_emails: to, cc_emails: cc, active: v.active, notes: v.notes.trim() || null, updated_at: new Date().toISOString() };
      const { error } = await supabase.from("hiring_email_configs").upsert(row);
      if (error) throw error;
      await supabase.from("hiring_email_config_history").insert({ client_id: client, to_emails: to, cc_emails: cc, active: v.active, notes: row.notes });
    },
    onSuccess: () => { toast.success("Destinatários salvos."); qc.invalidateQueries({ queryKey: ["hiring-mail-cfg"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="panel space-y-3 p-4">
        <div className="space-y-1"><Label>Cliente</Label>
          <Select value={client} onValueChange={pick}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{base.clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select></div>
        {client && <>
          <div className="space-y-1"><Label>Para (separe por vírgula)</Label><Textarea value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></div>
          <div className="space-y-1"><Label>CC</Label><Textarea value={v.cc} onChange={(e) => setV({ ...v, cc: e.target.value })} /></div>
          <div className="space-y-1"><Label>Observações</Label><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={v.active} onCheckedChange={(a) => setV({ ...v, active: a })} />Ativa</label>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{cur ? "Salvar alterações" : "Salvar"}</Button>
        </>}
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Para</TableHead><TableHead>CC</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
          <TableBody>
            {(configs.data ?? []).map((c) => (
              <TableRow key={c.client_id} className="cursor-pointer" onClick={() => pick(c.client_id)}>
                <TableCell>{base.clients.find((x) => x.id === c.client_id)?.name ?? "—"}</TableCell>
                <TableCell className="text-xs">{c.to_emails.join(", ")}</TableCell>
                <TableCell className="text-xs">{c.cc_emails.join(", ")}</TableCell>
                <TableCell>{c.active ? "Ativa" : "Inativa"}</TableCell>
              </TableRow>
            ))}
            {!configs.data?.length && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Nenhum cliente configurado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

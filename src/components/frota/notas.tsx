import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ExternalLink, FolderCog, Link2, Pencil, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAll } from "@/lib/results-engine";
import { normalizePlate } from "@/lib/fleet-costs";
import { baseFolderPath, fuelRateio, isoDay, monthLabel, noteStatus, otherPlates, photoTime, type ItemAccount, type Rateio, type RateioClient, type RateioWork } from "@/lib/fleet-notes";
import { fleetNoteLink, fleetNoteThumbnails, syncFleetNotesNow } from "@/lib/fleet-notes.functions";
import type { Tables } from "@/integrations/supabase/types";

type Note = Tables<"fleet_fuel_notes">;
type Row = Note & { day: string | null; plateShown: string | null; kmShown: number | null; driverShown: string | null; vehicleLabel: string | null; rateio: Rateio | null; status: ReturnType<typeof noteStatus>; warnings: string[] };
type Filter = "pendentes" | "sem-nota" | "aguardando" | "aprovadas" | "todas";

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d }));
const brDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number) as [number, number]; return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const MATCH_LABEL: Record<string, string> = { chave: "ok", nf: "pelo nº da NF", manual: "atribuída", hora: "pela hora: confira", leitura: "lido na foto" };

/** Frota › Notas: abastecimentos (XML do posto) e equivalências de item conta. */
export function FleetNotesPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Notas"
        description="Cada XML do posto na pasta do mês vira um abastecimento. A nota é procurada na pasta de notas do mês pelo código de acesso (nome do arquivo); se não achar, atribua à mão. O rateio usa os dias em que o veículo esteve em cada cliente na Transporte, desde o abastecimento anterior."
      />
      <Tabs defaultValue="abastecimentos">
        <TabsList>
          <TabsTrigger value="abastecimentos">Abastecimentos</TabsTrigger>
          <TabsTrigger value="equivalencias">Equivalências item conta</TabsTrigger>
        </TabsList>
        <TabsContent value="abastecimentos" className="mt-4"><FuelNotes /></TabsContent>
        <TabsContent value="equivalencias" className="mt-4"><ItemAccounts /></TabsContent>
      </Tabs>
    </div>
  );
}

function FuelNotes() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [filter, setFilter] = useState<Filter>("pendentes");
  const [plate, setPlate] = useState("all");
  const [approve, setApprove] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [attach, setAttach] = useState<Row | null>(null);
  const [folders, setFolders] = useState(false);
  const start = `${month}-01`, end = lastDay(month), lookback = addDays(start, -90);

  const settings = useQuery({ queryKey: ["fleet-settings"], queryFn: async () => Object.fromEntries(((await supabase.from("fleet_settings").select("key, value")).data ?? []).map((s) => [s.key, s.value])) as Record<string, string | null> });
  const notes = useQuery({
    queryKey: ["fleet-fuel-notes", month],
    queryFn: () => fetchAll<Note>((a, b) => supabase.from("fleet_fuel_notes").select("*")
      .or(`ref_month.eq.${month},and(issued_at.gte.${lookback},issued_at.lte.${end}T23:59:59)`).order("issued_at").range(a, b)),
  });
  const docs = useQuery({ queryKey: ["fleet-note-docs", month], queryFn: async () => (await supabase.from("fleet_note_docs").select("file_name, item_id, read_nf, read_plate, read_total, read_error").eq("ref_month", month).order("file_name")).data ?? [] });
  const vehicles = useQuery({ queryKey: ["fleet-vehicles-basic"], queryFn: async () => (await supabase.from("vehicles").select("id, plate, model").order("plate")).data ?? [] });
  const schedules = useQuery({
    queryKey: ["fleet-rateio-schedules", lookback, end],
    queryFn: () => fetchAll<any>((a, b) => supabase.from("vehicle_schedules").select("vehicle_id, schedule_date, client_id, extra_client_ids, is_maintenance")
      .gte("schedule_date", lookback).lte("schedule_date", end).order("schedule_date").range(a, b)),
  });
  const clients = useQuery({ queryKey: ["fleet-rateio-clients"], queryFn: async () => ((await supabase.from("clients").select("id, name, cc_prefix")).data ?? []) as RateioClient[] });
  const works = useQuery({ queryKey: ["fleet-rateio-works"], queryFn: async () => ((await supabase.from("works").select("id, client_id, cc_suffix, active")).data ?? []) as RateioWork[] });
  const accounts = useQuery({ queryKey: ["fleet-item-accounts"], queryFn: async () => ((await supabase.from("fleet_item_accounts").select("*").order("cc_code")).data ?? []) as Tables<"fleet_item_accounts">[] });
  const people = useQuery({ queryKey: ["users-names"], queryFn: async () => new Map(((await supabase.from("users_profiles").select("id, full_name")).data ?? []).map((u) => [u.id, u.full_name])) });

  const syncFn = useServerFn(syncFleetNotesNow);
  const sync = useMutation({
    mutationFn: () => syncFn({ data: { month } }),
    onSuccess: (r) => {
      toast.success(`${r.saved} abastecimento(s) de ${r.xml} XML · ${r.docs} nota(s) na pasta${r.photosRead ? ` · ${r.photosRead} foto(s) lida(s)` : ""}.`);
      r.errors.slice(0, 3).forEach((e) => toast.warning(e));
      qc.invalidateQueries({ queryKey: ["fleet-fuel-notes"] });
      qc.invalidateQueries({ queryKey: ["fleet-note-docs"] });
      qc.invalidateQueries({ queryKey: ["fleet-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo<Row[]>(() => {
    const all = notes.data ?? [];
    const plateOf = (n: Note) => normalizePlate(n.plate_fix ?? n.plate ?? "") || null;
    const vehicleByPlate = new Map((vehicles.data ?? []).map((v) => [normalizePlate(v.plate), v]));
    const clientMap = new Map((clients.data ?? []).map((c) => [c.id, c]));
    const ordered = [...all].sort((a, b) => String(a.issued_at).localeCompare(String(b.issued_at)) || a.access_key.localeCompare(b.access_key));
    return ordered.filter((n) => n.ref_month === month).map((n) => {
      const p = plateOf(n);
      const v = p ? vehicleByPlate.get(p) : undefined;
      const day = isoDay(n.issued_at);
      const idx = ordered.indexOf(n);
      const prev = p ? [...ordered.slice(0, idx)].reverse().find((o) => plateOf(o) === p) : undefined;
      const rateio = n.approved_at && n.allocation ? (n.allocation as unknown as Rateio)
        : day && schedules.data ? fuelRateio({ vehicleId: v?.id ?? null, day, prevDay: isoDay(prev?.issued_at ?? null), total: Number(n.total ?? 0), schedules: schedules.data, clients: clientMap, works: works.data ?? [], accounts: (accounts.data ?? []) as ItemAccount[] })
        : null;
      const kmShown = n.km_fix ?? n.km;
      const prevKm = prev ? prev.km_fix ?? prev.km : null;
      const warnings = [
        ...(n.plate_fix ? [] : otherPlates(n.info, p).map((o) => `outra placa no texto da nota: ${o}`)),
        ...(kmShown != null && prevKm != null && Number(kmShown) < Number(prevKm) ? [`km menor que o abastecimento anterior (${Number(prevKm).toLocaleString("pt-BR")})`] : []),
      ];
      return { ...n, day, plateShown: p, kmShown, driverShown: n.driver_fix ?? n.driver, vehicleLabel: v ? (v.model ?? v.plate) : null, rateio, status: noteStatus(n), warnings };
    });
  }, [notes.data, vehicles.data, clients.data, works.data, accounts.data, schedules.data, month]);

  const plates = [...new Set(rows.map((r) => r.plateShown).filter((p): p is string => !!p))].sort();
  const shown = rows.filter((r) => (plate === "all" || r.plateShown === plate) && (
    filter === "todas" ? true : filter === "pendentes" ? r.status !== "aprovada" : filter === "sem-nota" ? r.status === "sem-nota" : filter === "aguardando" ? r.status === "pendente" : r.status === "aprovada"));
  const count = (s: Row["status"]) => rows.filter((r) => r.status === s).length;
  const usedDocs = new Set(rows.map((r) => r.note_file).filter(Boolean));
  const freeDocs = (docs.data ?? []).filter((d) => !usedDocs.has(d.file_name));
  const loading = notes.isLoading || schedules.isLoading || vehicles.isLoading;
  const synced = settings.data?.[`synced:${month}`];

  const linkFn = useServerFn(fleetNoteLink);
  async function openDoc(file: string) {
    const doc = (docs.data ?? []).find((d) => d.file_name === file);
    if (!doc?.item_id) { toast.error("Arquivo não encontrado na pasta do mês. Clique em Ler pastas."); return; }
    try { const url = await linkFn({ data: { itemId: doc.item_id } }); if (url) window.open(url, "_blank", "noopener"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível abrir a nota."); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="notes-month">Mês</Label>
          <Input id="notes-month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Situação</Label>
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendentes">Pendentes (não aprovadas)</SelectItem>
              <SelectItem value="sem-nota">Sem nota</SelectItem>
              <SelectItem value="aguardando">Com nota, aguardando aprovação</SelectItem>
              <SelectItem value="aprovadas">Aprovadas</SelectItem>
              <SelectItem value="todas">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Placa</Label>
          <Select value={plate} onValueChange={setPlate}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {plates.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => setFolders(true)}><FolderCog className="h-4 w-4" /> Pastas</Button>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} /> {sync.isPending ? "Lendo pastas..." : "Ler pastas"}
        </Button>
        <p className="pb-2 text-xs text-muted-foreground">
          {!settings.data?.["xml_folder"] ? "Informe as pastas dos XML e das notas em Pastas." : synced ? `${monthLabel(month)} lido em ${new Date(synced).toLocaleString("pt-BR")}.` : `${monthLabel(month)} ainda não foi lido: clique em Ler pastas.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="XML no mês" value={String(rows.length)} />
        <Kpi label="Sem nota" value={String(count("sem-nota"))} tone={count("sem-nota") ? "bad" : undefined} />
        <Kpi label="Aguardando aprovação" value={String(count("pendente"))} />
        <Kpi label="Aprovadas" value={String(count("aprovada"))} />
        <Kpi label="Total do mês" value={brl(rows.reduce((s, r) => s + Number(r.total ?? 0), 0))} />
      </div>

      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>NF</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead className="text-right">Km</TableHead>
              <TableHead>Combustível</TableHead>
              <TableHead className="text-right">Qtd (L)</TableHead>
              <TableHead className="text-right">R$/L</TableHead>
              <TableHead className="text-right">Valor total</TableHead>
              <TableHead>Local rateio</TableHead>
              <TableHead>Centro de custo</TableHead>
              <TableHead>Item conta</TableHead>
              <TableHead>Nota</TableHead>
              <TableHead>Observações</TableHead>
              <TableHead className="text-right">Aprovação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={16} className="text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : !shown.length ? (
              <TableRow><TableCell colSpan={16} className="text-muted-foreground">{rows.length ? "Nenhum abastecimento nesta situação." : "Nenhum XML lido neste mês."}</TableCell></TableRow>
            ) : shown.map((r) => {
              const parts = r.rateio?.parts ?? [];
              return (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap">{brDate(r.day)}</TableCell>
                  <TableCell>{r.nf_number ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.plateShown ?? <span className="text-destructive">sem placa</span>}{r.plate_fix ? " *" : ""}
                    {r.warnings.map((w) => <div key={w} className="max-w-48 whitespace-normal text-amber-600 dark:text-amber-400">⚠ {w}</div>)}
                  </TableCell>
                  <TableCell>{r.driverShown ?? "—"}</TableCell>
                  <TableCell>{r.vehicleLabel ?? (r.plateShown ? <span className="text-destructive">não cadastrado</span> : "—")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.kmShown == null ? "—" : num(r.kmShown, 0)}</TableCell>
                  <TableCell>{r.fuel ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.quantity, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.unit_price, 3)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.total)}</TableCell>
                  <TableCell className="min-w-36">
                    {parts.length ? parts.map((p) => <div key={p.client_id} className="whitespace-nowrap">{p.client} {p.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</div>)
                      : <span className="text-destructive">sem programação</span>}
                    {r.rateio?.fallback && <div className="text-muted-foreground">último dia programado</div>}
                  </TableCell>
                  <TableCell>{parts.map((p) => <div key={p.client_id} className="whitespace-nowrap" title={p.cc_rule}>{p.cc ?? <span className="text-destructive">{p.cc_rule}</span>}</div>)}</TableCell>
                  <TableCell>{parts.map((p) => <div key={p.client_id} className="whitespace-nowrap">{p.item_account ?? <span className="text-muted-foreground">sem equivalência</span>}</div>)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.note_file ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className={r.note_match === "hora" ? "cursor-pointer border-amber-500/60 text-amber-700 dark:text-amber-400" : "border-emerald-500/50 text-emerald-700 dark:text-emerald-400"} onClick={() => !r.approved_at && setAttach(r)}>{MATCH_LABEL[r.note_match ?? "manual"]}</Badge>
                        <Button variant="ghost" size="icon" className="h-6 w-6" title={`Abrir ${r.note_file}`} onClick={() => openDoc(r.note_file!)}><ExternalLink className="h-3.5 w-3.5" /></Button>
                        {!r.approved_at && <Button variant="ghost" size="icon" className="h-6 w-6" title="Trocar nota" onClick={() => setAttach(r)}><Link2 className="h-3.5 w-3.5" /></Button>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Badge variant="destructive">sem nota</Badge>
                        {!r.approved_at && <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => setAttach(r)}><Link2 className="h-3.5 w-3.5" /> Atribuir</Button>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="min-w-32 max-w-56">
                    <div className="flex items-start gap-1">
                      <span className="flex-1 whitespace-pre-wrap">{r.notes || <span className="text-muted-foreground">—</span>}</span>
                      {!r.approved_at && <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Corrigir dados e observações" onClick={() => setEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.approved_at ? (
                      <div className="space-y-1">
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Aprovada</Badge>
                        <div className="text-muted-foreground">{people.data?.get(r.approved_by ?? "") ?? "—"} · {new Date(r.approved_at).toLocaleDateString("pt-BR")}</div>
                        {r.approval_notes && <div className="max-w-48 whitespace-pre-wrap text-left">{r.approval_notes}</div>}
                        <UndoApproval id={r.id} />
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setApprove(r)}><Check className="h-4 w-4" /> Aprovar</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {shown.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={7}>{shown.length} abastecimento(s)</TableCell>
                <TableCell className="text-right tabular-nums">{num(shown.reduce((s, r) => s + Number(r.quantity ?? 0), 0), 2)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{brl(shown.reduce((s, r) => s + Number(r.total ?? 0), 0))}</TableCell>
                <TableCell colSpan={6} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <ApproveDialog row={approve} onClose={() => setApprove(null)} />
      <EditDialog row={edit} onClose={() => setEdit(null)} />
      <AttachDialog row={attach} month={month} docs={attach?.note_file ? [...(docs.data ?? []).filter((d) => d.file_name === attach.note_file), ...freeDocs] : freeDocs} onClose={() => setAttach(null)} />
      <FoldersDialog open={folders} onClose={() => setFolders(false)} values={settings.data ?? {}} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="panel p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function useNoteUpdate(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Note> }) => {
      const { error } = await supabase.from("fleet_fuel_notes").update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fleet-fuel-notes"] }); onDone?.(); },
    onError: (e: Error) => toast.error(e.message),
  });
}

function UndoApproval({ id }: { id: string }) {
  const m = useNoteUpdate(() => toast.success("Aprovação desfeita."));
  return <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" disabled={m.isPending} onClick={() => m.mutate({ id, patch: { approved_at: null } })}><Undo2 className="h-3.5 w-3.5" /> Desfazer</Button>;
}

function ApproveDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [text, setText] = useState("");
  useEffect(() => { setText(""); }, [row?.id]);
  const m = useNoteUpdate(() => { toast.success("Abastecimento aprovado."); onClose(); });
  if (!row) return null;
  const parts = row.rateio?.parts ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Aprovar abastecimento</DialogTitle>
          <DialogDescription>NF {row.nf_number ?? "—"} · {row.plateShown ?? "sem placa"} · {brDate(row.day)} · {brl(row.total)}</DialogDescription>
        </DialogHeader>
        {!row.note_file && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">Este abastecimento está sem nota.</p>}
        {row.note_match === "hora" && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-400">A nota foi ligada pela hora da foto e ainda não foi conferida.</p>}
        {row.warnings.map((w) => <p key={w} className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-400">{w}</p>)}
        <div className="rounded-md border border-border text-sm">
          {parts.length ? parts.map((p) => (
            <div key={p.client_id} className="flex justify-between gap-2 border-b border-border px-3 py-1.5 last:border-0">
              <span>{p.client} · {p.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%<span className="block text-xs text-muted-foreground">CC {p.cc ?? p.cc_rule} · item conta {p.item_account ?? "sem equivalência"}</span></span>
              <span className="tabular-nums">{brl(p.value)}</span>
            </div>
          )) : <p className="p-3 text-destructive">Sem programação do veículo para ratear.</p>}
        </div>
        {row.rateio && <p className="text-xs text-muted-foreground">Período do rateio: {brDate(row.rateio.from)} a {brDate(row.rateio.to)}{row.rateio.fallback ? " (sem programação no período: último dia programado)" : ""}. Ao aprovar, o rateio fica guardado como está.</p>}
        <div className="space-y-1">
          <Label htmlFor="approve-notes">Observações da aprovação</Label>
          <Textarea id="approve-notes" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={m.isPending} onClick={() => m.mutate({ id: row.id, patch: { approved_at: new Date().toISOString(), approval_notes: text.trim() || null, allocation: (row.rateio ?? null) as never } })}>
            <Check className="h-4 w-4" /> Aprovar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const [form, setForm] = useState({ plate: "", km: "", driver: "", notes: "" });
  useEffect(() => {
    if (row) setForm({ plate: row.plate_fix ?? "", km: row.km_fix == null ? "" : String(row.km_fix), driver: row.driver_fix ?? "", notes: row.notes ?? "" });
  }, [row?.id]);
  const m = useNoteUpdate(() => { toast.success("Abastecimento atualizado."); onClose(); });
  if (!row) return null;
  const km = form.km.trim() ? Number(form.km.replace(/\./g, "").replace(",", ".")) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Corrigir abastecimento</DialogTitle>
          <DialogDescription>NF {row.nf_number ?? "—"}. Deixe em branco para usar o que veio no XML.</DialogDescription>
        </DialogHeader>
        {row.info && <p className="max-h-28 overflow-y-auto rounded-md bg-muted p-2 text-xs">{row.info}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="fix-plate">Placa</Label><Input id="fix-plate" placeholder={row.plate ?? ""} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1"><Label htmlFor="fix-km">Km</Label><Input id="fix-km" inputMode="decimal" placeholder={row.km == null ? "" : String(row.km)} value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="fix-driver">Motorista</Label><Input id="fix-driver" placeholder={row.driver ?? ""} value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="fix-notes">Observações</Label><Textarea id="fix-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={m.isPending || (km != null && !Number.isFinite(km))} onClick={() => m.mutate({ id: row.id, patch: {
            plate_fix: form.plate.trim() ? normalizePlate(form.plate) : null, km_fix: km, driver_fix: form.driver.trim() || null, notes: form.notes.trim() || null,
          } })}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const timeLabel = (t: number | null) => (t == null ? null : new Date(t).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));

type Doc = { file_name: string; item_id: string | null; read_nf?: string | null; read_plate?: string | null; read_total?: number | null; read_error?: string | null };
const readingLabel = (d: Doc) => [d.read_nf ? `NF ${d.read_nf}` : null, d.read_plate, d.read_total != null ? brl(d.read_total) : null].filter(Boolean).join(" · ");

function AttachDialog({ row, month, docs, onClose }: { row: Row | null; month: string; docs: Doc[]; onClose: () => void }) {
  const [file, setFile] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { setFile(row?.note_file ?? ""); setQ(""); }, [row?.id]);
  const m = useNoteUpdate(() => { toast.success("Nota atualizada."); onClose(); });
  const thumbFn = useServerFn(fleetNoteThumbnails);
  const thumbs = useQuery({
    queryKey: ["fleet-note-thumbs", month], enabled: !!row, staleTime: 20 * 60_000,
    queryFn: async () => new Map((await thumbFn({ data: { month } })).map((t) => [t.name, t])),
  });
  if (!row) return null;
  const emitted = row.issued_at ? Date.parse(row.issued_at) : null;
  // Mais perto da hora do abastecimento primeiro.
  const list = docs.filter((d) => d.file_name.toLowerCase().includes(q.toLowerCase()))
    .map((d) => ({ ...d, time: photoTime(d.file_name) }))
    .sort((a, b) => (a.file_name === row.note_file ? -1 : b.file_name === row.note_file ? 1 : 0)
      || Number(b.read_nf === row.nf_number) - Number(a.read_nf === row.nf_number)
      || Number(b.read_plate === row.plateShown) - Number(a.read_plate === row.plateShown)
      || (emitted == null ? 0 : Math.abs((a.time ?? 0) - emitted) - Math.abs((b.time ?? 0) - emitted)) || a.file_name.localeCompare(b.file_name));
  const preview = file ? thumbs.data?.get(file)?.large : null;
  const confirming = !!file && file === row.note_file && row.note_match === "hora";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nota do abastecimento</DialogTitle>
          <DialogDescription>
            NF {row.nf_number ?? "—"} · {row.plateShown ?? "sem placa"} · {brl(row.total)} · abastecido em {timeLabel(emitted) ?? "—"}. Escolha a foto da nota. Vêm primeiro as que a leitura da foto achou com o mesmo nº de NF ou a mesma placa, depois as mais próximas da hora; só aparecem as que não estão em outra linha.
          </DialogDescription>
        </DialogHeader>
        {preview && <img src={preview} alt={`Nota ${file}`} className="mx-auto max-h-[45vh] rounded-md border border-border object-contain" />}
        <div className="space-y-1">
          <Label htmlFor="attach-search">Procurar</Label>
          <Input id="attach-search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.length ? (
          <div className="grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
            {list.map((d) => {
              const t = thumbs.data?.get(d.file_name);
              return (
                <button key={d.file_name} type="button" onClick={() => setFile(d.file_name)}
                  className={`rounded-md border p-1 text-left text-xs hover:bg-accent ${file === d.file_name ? "border-primary ring-2 ring-primary" : "border-border"}`}>
                  {t?.small ? <img src={t.small} alt="" className="mb-1 h-24 w-full rounded object-cover" loading="lazy" />
                    : <div className="mb-1 flex h-24 items-center justify-center rounded bg-muted text-muted-foreground">{thumbs.isLoading ? "carregando..." : "sem prévia"}</div>}
                  <div className="truncate font-medium">{timeLabel(d.time) ?? d.file_name}</div>
                  {readingLabel(d) && <div className={`truncate ${d.read_nf === row.nf_number ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{readingLabel(d)}</div>}
                  {d.file_name === row.note_file && <div className="text-muted-foreground">atual</div>}
                </button>
              );
            })}
          </div>
        ) : <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">Nenhuma foto livre na pasta de notas deste mês.</p>}
        <DialogFooter>
          {row.note_file && <Button variant="ghost" className="mr-auto text-destructive" disabled={m.isPending} onClick={() => m.mutate({ id: row.id, patch: { note_file: null } })}><Trash2 className="h-4 w-4" /> Tirar nota</Button>}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          {confirming
            ? <Button disabled={m.isPending} onClick={() => m.mutate({ id: row.id, patch: { note_match: "manual" } })}><Check className="h-4 w-4" /> Confirmar esta nota</Button>
            : <Button disabled={!file || file === row.note_file || m.isPending} onClick={() => m.mutate({ id: row.id, patch: { note_file: file } })}>Atribuir</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FoldersDialog({ open, onClose, values }: { open: boolean; onClose: () => void; values: Record<string, string | null> }) {
  const qc = useQueryClient();
  const [xml, setXml] = useState("");
  const [nf, setNf] = useState("");
  useEffect(() => { if (open) { setXml(values["xml_folder"] ?? ""); setNf(values["notes_folder"] ?? ""); } }, [open]);
  const save = useMutation({
    mutationFn: async () => {
      const rows = [{ key: "xml_folder", value: xml.trim() ? baseFolderPath(xml) : null }, { key: "notes_folder", value: nf.trim() ? baseFolderPath(nf) : null }]
        .map((r) => ({ ...r, updated_at: new Date().toISOString() }));
      const { error } = await supabase.from("fleet_settings").upsert(rows);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pastas salvas."); qc.invalidateQueries({ queryKey: ["fleet-settings"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pastas do posto</DialogTitle>
          <DialogDescription>Cole o caminho da pasta (do computador ou do SharePoint). Dentro dela fica uma pasta por mês; o sistema acha a do mês selecionado pelo nome (ex.: "11", "11.2026", "Novembro", ou dentro de uma pasta do ano).</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="xml-folder">Pasta dos XML</Label>
          <Input id="xml-folder" value={xml} onChange={(e) => setXml(e.target.value)} placeholder="Compras/06 FISCAL/..." />
          {xml.trim() && <p className="text-xs text-muted-foreground">SharePoint: {baseFolderPath(xml)}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes-folder">Pasta das notas</Label>
          <Input id="notes-folder" value={nf} onChange={(e) => setNf(e.target.value)} placeholder="Compras/06 FISCAL/..." />
          {nf.trim() && <p className="text-xs text-muted-foreground">SharePoint: {baseFolderPath(nf)}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemAccounts() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ id: "", cc: "", item: "", description: "" });
  const list = useQuery({ queryKey: ["fleet-item-accounts"], queryFn: async () => ((await supabase.from("fleet_item_accounts").select("*").order("cc_code")).data ?? []) as Tables<"fleet_item_accounts">[] });
  const clients = useQuery({ queryKey: ["fleet-rateio-clients"], queryFn: async () => ((await supabase.from("clients").select("id, name, cc_prefix")).data ?? []) as RateioClient[] });
  const prefixName = (cc: string) => (clients.data ?? []).find((c) => c.cc_prefix && cc.startsWith(c.cc_prefix))?.name ?? null;
  const done = () => { qc.invalidateQueries({ queryKey: ["fleet-item-accounts"] }); setForm({ id: "", cc: "", item: "", description: "" }); };
  const save = useMutation({
    mutationFn: async () => {
      const row = { cc_code: form.cc.replace(/\s/g, ""), item_account: form.item.trim(), description: form.description.trim() || null, updated_at: new Date().toISOString() };
      if (!row.cc_code || !row.item_account) throw new Error("Preencha o centro de custo e o item conta.");
      const { error } = form.id ? await supabase.from("fleet_item_accounts").update(row).eq("id", form.id) : await supabase.from("fleet_item_accounts").insert(row);
      if (error) throw error.code === "23505" ? new Error("Este centro de custo já tem equivalência.") : error;
    },
    onSuccess: () => { toast.success("Equivalência salva."); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("fleet_item_accounts").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Equivalência excluída."); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">O item conta de cada parte do rateio vem do centro de custo dela. Use o CC completo (ex.: 0102999) ou só o prefixo do cliente (4 dígitos) para valer para todos os CC do cliente.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="eq-cc">Centro de custo</Label><Input id="eq-cc" className="w-40" value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="eq-item">Item conta</Label><Input id="eq-item" className="w-40" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="eq-desc">Descrição</Label><Input id="eq-desc" className="w-72" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{form.id ? "Salvar" : "Adicionar"}</Button>
        {form.id && <Button variant="ghost" onClick={() => setForm({ id: "", cc: "", item: "", description: "" })}>Cancelar</Button>}
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Centro de custo</TableHead><TableHead>Cliente</TableHead><TableHead>Item conta</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
          <TableBody>
            {!(list.data ?? []).length ? (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">{list.isLoading ? "Carregando..." : "Nenhuma equivalência cadastrada."}</TableCell></TableRow>
            ) : (list.data ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.cc_code}</TableCell>
                <TableCell>{prefixName(a.cc_code) ?? "—"}</TableCell>
                <TableCell>{a.item_account}</TableCell>
                <TableCell>{a.description ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setForm({ id: a.id, cc: a.cc_code, item: a.item_account, description: a.description ?? "" })}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

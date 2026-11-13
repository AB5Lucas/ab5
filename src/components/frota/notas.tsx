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
import { baseFolderPath, closestPlate, fixedRateio, fuelRateio, isoDay, matchDriverName, plateRuleSplit, titleCase, FIXED_PLATE_CC, type CcSplitItem, monthLabel, noteStatus, otherPlates, photoTime, type ItemAccount, type Rateio, type RateioClient, type RateioWork } from "@/lib/fleet-notes";
import { fleetNoteLink, fleetNoteThumbnails, syncFleetNotesNow } from "@/lib/fleet-notes.functions";
import { DriverRanking } from "./ranking";
import { PlateFilter } from "./plate-filter";
import { FleetRelease, useCnhPeople, useFleetRelease } from "./liberacao";
import { FleetFiscal } from "./fiscal";
import { FleetFiscalCc } from "./fiscal-cc";
import { useFuelRows, useOpenInvoicesTotal, type Note, type Row } from "./use-fuel-rows";
import { balanceTone, fleetBalance } from "@/lib/fleet-balance";
import { nonTicketTotal } from "@/lib/fleet-fiscal";
import { applyColumnFilters, FilterHead, rowsForColumn, type ColumnDef, type ColumnFilters, type ColumnSort } from "@/components/column-filter";
import { currentMonthRange, DateRangePicker, monthsInRange, type DayRange } from "@/components/date-range-picker";
import type { Tables } from "@/integrations/supabase/types";

type Filter = "pendentes" | "sem-nota" | "aguardando" | "aprovadas" | "todas";

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d }));
const brDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const MATCH_LABEL: Record<string, string> = { chave: "ok", nf: "pelo nº da NF", manual: "atribuída", hora: "pela hora: confira", leitura: "lido na foto" };

/** Frota › Abastecimento: abastecimentos (XML do posto) e equivalências de item conta. */
export function FleetNotesPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Abastecimento"
        description="Cada XML do posto na pasta do mês vira um abastecimento. A nota é procurada na pasta de notas do mês pelo código de acesso (nome do arquivo); se não achar, atribua à mão. Nota com dois combustíveis vira duas linhas. Nome e placa da nota viram os cadastrados (aba Liberação). O rateio usa o km que o veículo rodou em cada cliente na Transporte desde o abastecimento anterior (sem km lançado, os dias)."
      />
      <Tabs defaultValue="abastecimentos">
        <TabsList>
          <TabsTrigger value="abastecimentos">Abastecimentos</TabsTrigger>
          <TabsTrigger value="liberacao">Liberação</TabsTrigger>
          <TabsTrigger value="equivalencias">Item Conta</TabsTrigger>
          <TabsTrigger value="ranking">Ranking</TabsTrigger>
          <TabsTrigger value="fatura">Fatura</TabsTrigger>
          <TabsTrigger value="fiscal">Fiscal</TabsTrigger>
        </TabsList>
        <TabsContent value="abastecimentos" className="mt-4"><FuelNotes /></TabsContent>
        <TabsContent value="liberacao" className="mt-4"><FleetRelease /></TabsContent>
        <TabsContent value="equivalencias" className="mt-4"><ItemAccounts /></TabsContent>
        <TabsContent value="ranking" className="mt-4"><DriverRanking /></TabsContent>
        <TabsContent value="fatura" className="mt-4"><FleetFiscal /></TabsContent>
        <TabsContent value="fiscal" className="mt-4"><FleetFiscalCc /></TabsContent>
      </Tabs>
    </div>
  );
}

function FuelNotes() {
  const qc = useQueryClient();
  const [range, setRange] = useState<DayRange>(() => currentMonthRange());
  const months = monthsInRange(range);
  const [filter, setFilter] = useState<Filter>("pendentes");
  const [plate, setPlate] = useState("all");
  const [approve, setApprove] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [attach, setAttach] = useState<Row | null>(null);
  const [folders, setFolders] = useState(false);
  const start = range.from, end = range.to;

  const { settings, notes, docs, vehicles, schedules, accounts, people, rows } = useFuelRows(range);

  const syncFn = useServerFn(syncFleetNotesNow);
  const sync = useMutation({
    // Uma pasta por mês: lê todos os meses que o período cobre, um de cada vez.
    mutationFn: async () => {
      const out = { saved: 0, xml: 0, docs: 0, photosRead: 0, errors: [] as string[] };
      for (const m of months) {
        try {
          const r = await syncFn({ data: { month: m } });
          out.saved += r.saved; out.xml += r.xml; out.docs += r.docs; out.photosRead += r.photosRead ?? 0;
          out.errors.push(...r.errors.map((e) => (months.length > 1 ? `${monthLabel(m)}: ${e}` : e)));
        } catch (e) {
          out.errors.push(`${monthLabel(m)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return out;
    },
    onSuccess: (r) => {
      toast.success(`${r.saved} abastecimento(s) de ${r.xml} XML · ${r.docs} nota(s) na pasta${r.photosRead ? ` · ${r.photosRead} foto(s) lida(s)` : ""}.`);
      r.errors.slice(0, 4).forEach((e) => toast.warning(e));
      qc.invalidateQueries({ queryKey: ["fleet-fuel-notes"] });
      qc.invalidateQueries({ queryKey: ["fleet-note-docs"] });
      qc.invalidateQueries({ queryKey: ["fleet-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const plates = [...new Set(rows.map((r) => r.plateShown).filter((p): p is string => !!p))].sort();
  const shown = rows.filter((r) => (plate === "all" || r.plateShown === plate) && (
    filter === "todas" ? true : filter === "pendentes" ? r.status !== "aprovada" : filter === "sem-nota" ? r.status === "sem-nota" : filter === "aguardando" ? r.status === "pendente" : r.status === "aprovada"));
  // Filtros e ordenação por coluna, como no Excel (em cima dos filtros de Situação e Placa).
  const [colFilters, setColFilters] = useState<ColumnFilters>({});
  const [colSort, setColSort] = useState<ColumnSort>(null);
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { key: "data", label: "Data", values: (r) => [brDate(r.day)], sort: (r) => r.day },
    { key: "nf", label: "NF", values: (r) => [r.nf_number ?? ""], sort: (r) => (r.nf_number ? Number(r.nf_number) : null) },
    { key: "placa", label: "Placa", values: (r) => [r.plateShown ?? "sem placa"] },
    { key: "motorista", label: "Motorista", values: (r) => [r.driverShown ?? ""] },
    { key: "veiculo", label: "Veículo", values: (r) => [r.vehicleLabel ?? (r.plateShown ? "não cadastrado" : "")] },
    { key: "km", label: "Km", align: "right", values: (r) => [r.kmShown == null ? "" : num(r.kmShown, 0)], sort: (r) => (r.kmShown == null ? null : Number(r.kmShown)) },
    { key: "combustivel", label: "Combustível", values: (r) => [r.fuel ?? ""] },
    { key: "qtd", label: "Qtd (L)", align: "right", values: (r) => [r.quantity == null ? "" : num(r.quantity, 2)], sort: (r) => (r.quantity == null ? null : Number(r.quantity)) },
    { key: "rl", label: "R$/L", align: "right", values: (r) => [r.unit_price == null ? "" : num(r.unit_price, 3)], sort: (r) => (r.unit_price == null ? null : Number(r.unit_price)) },
    { key: "total", label: "Valor total", align: "right", values: (r) => [r.total == null ? "" : brl(r.total)], sort: (r) => (r.total == null ? null : Number(r.total)) },
    { key: "rateio", label: "Local rateio", values: (r) => (r.rateio?.parts.length ? r.rateio.parts.map((p) => p.client) : ["sem programação"]) },
    { key: "cc", label: "Centro de custo", values: (r) => (r.rateio?.parts ?? []).map((p) => p.cc ?? p.cc_rule) },
    { key: "item", label: "Item conta", values: (r) => (r.rateio?.parts ?? []).map((p) => p.item_account ?? "sem equivalência") },
    { key: "nota", label: "Nota", values: (r) => [r.note_file ? MATCH_LABEL[r.note_match ?? "manual"] ?? "atribuída" : "sem nota"] },
    { key: "obs", label: "Observações", values: (r) => [r.notes ?? ""] },
    { key: "aprovacao", label: "Aprovação", align: "right", values: (r) => [r.approved_at ? "Aprovada" : "Não aprovada"] },
  ], []);
  const tableRows = useMemo(() => applyColumnFilters(shown, columns, colFilters, colSort), [shown, columns, colFilters, colSort]);
  const colFiltered = Object.keys(colFilters).length > 0;
  const count = (s: Row["status"]) => rows.filter((r) => r.status === s).length;
  // Fotos ligadas a algum XML do mês (não só aos do período), por mês + arquivo.
  const usedDocs = new Set((notes.data ?? []).filter((n) => n.note_file).map((n) => `${n.ref_month}|${n.note_file}`));
  const freeDocs = (docs.data ?? []).filter((d) => !usedDocs.has(`${d.ref_month}|${d.file_name}`) && d.ref_month === attach?.ref_month);
  // Cupons sem XML: fotos das notas que não ficaram ligadas a nenhum XML (pela data da foto, dentro do período).
  const orphanDocs = (docs.data ?? []).filter((d) => {
    if (usedDocs.has(`${d.ref_month}|${d.file_name}`)) return false;
    const t = photoTime(d.file_name);
    if (t == null) return true;
    const day = new Date(t - 3 * 3600_000).toISOString().slice(0, 10);
    return day >= start && day <= end;
  }).sort((a, b) => (photoTime(a.file_name) ?? 0) - (photoTime(b.file_name) ?? 0) || a.file_name.localeCompare(b.file_name));
  const [showOrphans, setShowOrphans] = useState(false);
  const openInvoices = useOpenInvoicesTotal();
  // TICKET (pago no ticket) não entra nas somas nem desconta do Saldo.
  const periodTotal = rows.reduce((s, r) => s + nonTicketTotal(r), 0);
  const balance = fleetBalance(openInvoices.data ?? 0, periodTotal);
  const loading = notes.isLoading || schedules.isLoading || vehicles.isLoading;
  const notRead = months.filter((m) => !settings.data?.[`synced:${m}`]);
  const lastRead = months.map((m) => settings.data?.[`synced:${m}`]).filter((v): v is string => !!v).sort().at(-1);

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
        <DateRangePicker id="notes-range" value={range} onChange={setRange} />
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
        <PlateFilter id="notes-plate" value={plate} onChange={setPlate}
          options={plates.map((p) => ({ plate: p, name: rows.find((r) => r.plateShown === p)?.vehicleLabel ?? null }))} />
        <Button variant="outline" onClick={() => setFolders(true)}><FolderCog className="h-4 w-4" /> Pastas</Button>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} /> {sync.isPending ? "Lendo pastas..." : "Ler pastas"}
        </Button>
        <p className="pb-2 text-xs text-muted-foreground">
          {!settings.data?.["xml_folder"] ? "Informe as pastas dos XML e das notas em Pastas."
            : notRead.length ? `${notRead.map(monthLabel).join(", ")} ainda não ${notRead.length > 1 ? "foram lidos" : "foi lido"}: clique em Ler pastas.`
            : lastRead ? `Pastas lidas em ${new Date(lastRead).toLocaleString("pt-BR")}${months.length > 1 ? ` (${months.length} meses)` : ""}.` : ""}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="XML no período" value={String(rows.length)} />
        <Kpi label="Sem nota" value={String(count("sem-nota"))} tone={count("sem-nota") ? "bad" : undefined} />
        <button type="button" className="text-left" onClick={() => setShowOrphans(true)} disabled={!orphanDocs.length} title={orphanDocs.length ? "Ver os cupons" : undefined}>
          <Kpi label="Cupons sem XML" value={String(orphanDocs.length)} tone={orphanDocs.length ? "bad" : undefined} />
        </button>
        <Kpi label="Aguardando aprovação" value={String(count("pendente"))} />
        <Kpi label="Saldo" value={brl(balance)} tone={balanceTone(balance)}
          title={`R$ 40.000 − faturas em aberto (${brl(openInvoices.data ?? 0)}) − total do período (${brl(periodTotal)})`} />
        <Kpi label="Total do período" value={brl(periodTotal)} />
      </div>

      {colFiltered && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Filtro nas colunas: {Object.keys(colFilters).map((k) => columns.find((c) => c.key === k)?.label).filter(Boolean).join(", ")}.
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setColFilters({})}>Limpar filtros das colunas</Button>
        </div>
      )}
      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <FilterHead key={c.key} column={c} rows={rowsForColumn(shown, columns, colFilters, c.key)}
                  filters={colFilters} setFilters={setColFilters} sort={colSort} setSort={setColSort} />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={16} className="text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : !tableRows.length ? (
              <TableRow><TableCell colSpan={16} className="text-muted-foreground">{!rows.length ? "Nenhum XML lido neste período." : colFiltered ? "Nenhum abastecimento com esses filtros nas colunas." : "Nenhum abastecimento nesta situação."}</TableCell></TableRow>
            ) : tableRows.map((r) => {
              const parts = r.rateio?.parts ?? [];
              return (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap">{brDate(r.day)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.nf_number ?? "—"}{r.itemCount > 1 && <div className="text-muted-foreground" title="Mesmo XML, outro combustível">item {r.item_no} de {r.itemCount}</div>}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.plateShown ?? <span className="text-destructive">sem placa</span>}{r.plate_fix ? " *" : ""}
                    {r.warnings.map((w) => <div key={w} className="max-w-48 whitespace-normal text-amber-600 dark:text-amber-400">⚠ {w}</div>)}
                  </TableCell>
                  <TableCell title={r.driver && titleCase(r.driver) !== r.driverShown ? `Na nota: ${r.driver}` : undefined}>{r.driverShown ?? "—"}{r.driver && r.driverShown && titleCase(r.driver) !== r.driverShown && <div className="text-muted-foreground">nota: {r.driver}</div>}</TableCell>
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
                    {!r.rateio?.fallback && r.rateio?.basis === "dias" && <div className="text-muted-foreground">sem km lançado: pelos dias</div>}
                    {!r.approved_at && r.rateio?.parts[0]?.client_id.startsWith("manual") && <div className="text-muted-foreground">{r.rateio.parts[0].cc_rule}</div>}
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
          {tableRows.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={7}>{tableRows.length} abastecimento(s){colFiltered ? " (com filtro nas colunas)" : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{num(tableRows.reduce((s, r) => s + Number(r.quantity ?? 0) * (r.total ? nonTicketTotal(r) / Number(r.total) : 1), 0), 2)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{brl(tableRows.reduce((s, r) => s + nonTicketTotal(r), 0))}</TableCell>
                <TableCell colSpan={6} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      <ApproveDialog row={approve} onClose={() => setApprove(null)} />
      <EditDialog row={edit} accounts={accounts.data ?? []} onClose={() => setEdit(null)} />
      <AttachDialog row={attach} month={attach?.ref_month ?? months[0]!} docs={attach?.note_file ? [...(docs.data ?? []).filter((d) => d.file_name === attach.note_file && d.ref_month === attach.ref_month), ...freeDocs] : freeDocs} onClose={() => setAttach(null)} />
      <FoldersDialog open={folders} onClose={() => setFolders(false)} values={settings.data ?? {}} />
      <Dialog open={showOrphans} onOpenChange={setShowOrphans}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cupons sem XML</DialogTitle>
            <DialogDescription>
              {orphanDocs.length} foto(s) de nota na pasta do mês que não ficaram ligadas a nenhum XML do posto. Pode faltar o XML na pasta, ou a foto ser de outro abastecimento: ligue pelo botão Atribuir da linha certa.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {orphanDocs.map((d) => {
              const reading = [d.read_nf ? `NF ${d.read_nf}` : null, d.read_plate, d.read_total != null ? brl(d.read_total) : null].filter(Boolean).join(" · ");
              return (
                <li key={`${d.ref_month}|${d.file_name}`} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{timeLabel(photoTime(d.file_name)) ?? d.file_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{reading || "sem leitura da foto"}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openDoc(d.file_name)}><ExternalLink className="h-4 w-4" /> Abrir</Button>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, tone, title }: { label: string; value: string; tone?: "bad" | "warn" | undefined; title?: string }) {
  return (
    <div className="panel p-3" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "warn" ? "text-orange-600 dark:text-orange-400" : ""}`}>{value}</div>
    </div>
  );
}

function useNoteUpdate(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    // sameXml: a foto é do XML todo, então nota atribuída/tirada vale para todos os itens dele ainda não aprovados.
    mutationFn: async ({ id, patch, sameXml }: { id: string; patch: Partial<Note>; sameXml?: string }) => {
      const q = supabase.from("fleet_fuel_notes").update(patch as never);
      const { error } = sameXml ? await q.eq("access_key", sameXml).is("approved_at", null) : await q.eq("id", id);
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
              <span>{p.client} · {p.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%{p.km ? ` · ${p.km.toLocaleString("pt-BR")} km` : ""}<span className="block text-xs text-muted-foreground">CC {p.cc ?? p.cc_rule} · item conta {p.item_account ?? "sem equivalência"}</span></span>
              <span className="tabular-nums">{brl(p.value)}</span>
            </div>
          )) : <p className="p-3 text-destructive">Sem programação do veículo para ratear.</p>}
        </div>
        {row.rateio && <p className="text-xs text-muted-foreground">Período do rateio: {brDate(row.rateio.from)} a {brDate(row.rateio.to)}{row.rateio.basis === "km" ? ", pelo km rodado em cada cliente" : row.rateio.basis === "dias" ? ", pelos dias (sem km lançado na Transporte)" : ""}{row.rateio.fallback ? " (sem programação no período: último dia programado)" : ""}. Ao aprovar, o rateio fica guardado como está.</p>}
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

type SplitLine = { account: string; pct: string };
const pctNum = (s: string) => Number(String(s).replace(",", "."));

function EditDialog({ row, accounts, onClose }: { row: Row | null; accounts: Tables<"fleet_item_accounts">[]; onClose: () => void }) {
  const [form, setForm] = useState({ plate: "", km: "", notes: "" });
  // Vazio = automático (rateio pela Transporte ou regra da placa); com linhas = CCs à mão, cada um com a sua %.
  const [split, setSplit] = useState<SplitLine[]>([]);
  useEffect(() => {
    if (!row) return;
    const findId = (cc: string, label: string | null) => (accounts.find((a) => a.cc_code === cc && (a.description ?? null) === (label ?? null)) ?? accounts.find((a) => a.cc_code === cc))?.id ?? "";
    const saved = (Array.isArray(row.cc_split) ? row.cc_split : []) as unknown as CcSplitItem[];
    const lines = saved.length ? saved.map((s) => ({ account: findId(s.cc_code, s.label), pct: String(s.pct) }))
      : row.cc_fix ? [{ account: findId(row.cc_fix, row.cc_label_fix), pct: "100" }] : [];
    setForm({ plate: row.plate_fix ?? "", km: row.km_fix == null ? "" : String(row.km_fix), notes: row.notes ?? "" });
    setSplit(lines);
  }, [row?.id]);
  const m = useNoteUpdate(() => { toast.success("Abastecimento atualizado."); onClose(); });
  if (!row) return null;
  const km = form.km.trim() ? Number(form.km.replace(/\./g, "").replace(",", ".")) : null;
  const totalPct = split.reduce((s, l) => s + (pctNum(l.pct) || 0), 0);
  const splitError = !split.length ? null
    : split.some((l) => !l.account) ? "Escolha o centro de custo de cada linha."
    : split.some((l) => !(pctNum(l.pct) > 0)) ? "Cada centro de custo precisa de uma % maior que zero."
    : new Set(split.map((l) => l.account)).size !== split.length ? "Há centro de custo repetido."
    : Math.abs(totalPct - 100) > 0.01 ? `A soma das % precisa dar 100 (está em ${totalPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}).` : null;
  const addLine = () => setSplit((s) => [...s, { account: "", pct: String(Math.max(0, Math.round((100 - s.reduce((a, l) => a + (pctNum(l.pct) || 0), 0)) * 100) / 100)) }]);
  const evenOut = () => setSplit((s) => {
    const each = Math.floor(10000 / s.length) / 100;
    return s.map((l, i) => ({ ...l, pct: String(i === s.length - 1 ? Math.round((100 - each * (s.length - 1)) * 100) / 100 : each) }));
  });
  const plateRule = FIXED_PLATE_CC[normalizePlate(form.plate || row.plate || "")];
  const toSave: CcSplitItem[] = split.map((l) => {
    const a = accounts.find((x) => x.id === l.account);
    return { cc_code: a?.cc_code ?? "", item_account: a?.item_account ?? null, label: a?.description ?? null, pct: pctNum(l.pct) };
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corrigir abastecimento</DialogTitle>
          <DialogDescription>NF {row.nf_number ?? "—"} · {brl(row.total)}. Deixe em branco para usar o que veio no XML.</DialogDescription>
        </DialogHeader>
        {row.info && <p className="max-h-28 overflow-y-auto rounded-md bg-muted p-2 text-xs">{row.info}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="fix-plate">Placa</Label><Input id="fix-plate" placeholder={row.plateShown ?? row.plate ?? ""} value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1"><Label htmlFor="fix-km">Km</Label><Input id="fix-km" inputMode="decimal" placeholder={row.km == null ? "" : String(row.km)} value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Motorista: {row.driverShown ?? "não identificado"}{row.driver && row.driverShown !== titleCase(row.driver) ? ` (na nota: ${row.driver})` : ""}. O nome vem da aba Liberação; para corrigir, libere o motorista lá.</p>
        <div className="space-y-2">
          <Label className="block">Centros de custo</Label>
          {!split.length ? (
            <p className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
              {plateRule ? `Automático: esta placa vai sempre para o CC ${plateRule}.` : "Automático: rateio pelos dias do veículo em cada cliente na Transporte."}
            </p>
          ) : split.map((l, i) => {
            const value = Number(row.total ?? 0) * ((pctNum(l.pct) || 0) / 100);
            return (
              <div key={i} className="flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  {i === 0 && <span className="block text-xs text-muted-foreground">Centro de custo (aba Item Conta)</span>}
                  <Select value={l.account || undefined} onValueChange={(v) => setSplit((s) => s.map((x, j) => (j === i ? { ...x, account: v } : x)))}>
                    <SelectTrigger><SelectValue placeholder="Escolha o CC" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.description ?? "—"} · CC {a.cc_code} · item {a.item_account}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-20 space-y-1">
                  {i === 0 && <span className="block text-xs text-muted-foreground">%</span>}
                  <Input inputMode="decimal" aria-label="Porcentagem" value={l.pct} onChange={(e) => setSplit((s) => s.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
                </div>
                <span className="w-24 pb-2 text-right text-xs tabular-nums text-muted-foreground">{brl(value)}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Remover centro de custo" onClick={() => setSplit((s) => s.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Centro de custo</Button>
            {split.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={evenOut}>Dividir igual</Button>}
            {split.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setSplit([])}>Voltar ao automático</Button>}
            {split.length > 0 && <span className={`ml-auto text-xs tabular-nums ${splitError ? "text-destructive" : "text-muted-foreground"}`}>Total {totalPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</span>}
          </div>
          {splitError && <p className="text-xs text-destructive">{splitError}</p>}
          {!splitError && split.length > 0 && <p className="text-xs text-muted-foreground">Sem rateio pela Transporte: o valor vai para esses CCs nessas %. Para um CC que não está na lista, cadastre-o na aba Item Conta.</p>}
        </div>
        <div className="space-y-1"><Label htmlFor="fix-notes">Observações</Label><Textarea id="fix-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={m.isPending || !!splitError || (km != null && !Number.isFinite(km))} onClick={() => m.mutate({ id: row.id, patch: {
            plate_fix: form.plate.trim() ? normalizePlate(form.plate) : null, km_fix: km, notes: form.notes.trim() || null,
            cc_split: (toSave.length ? toSave : null) as never, cc_fix: null, item_account_fix: null, cc_label_fix: null,
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
      || Number(!!b.read_plate && normalizePlate(b.read_plate) === normalizePlate(row.plateShown ?? "")) - Number(!!a.read_plate && normalizePlate(a.read_plate) === normalizePlate(row.plateShown ?? ""))
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
          {row.note_file && <Button variant="ghost" className="mr-auto text-destructive" disabled={m.isPending} onClick={() => m.mutate({ id: row.id, patch: { note_file: null }, sameXml: row.itemCount > 1 ? row.access_key : undefined })}><Trash2 className="h-4 w-4" /> Tirar nota</Button>}
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          {confirming
            ? <Button disabled={m.isPending} onClick={() => m.mutate({ id: row.id, patch: { note_match: "manual" }, sameXml: row.itemCount > 1 ? row.access_key : undefined })}><Check className="h-4 w-4" /> Confirmar esta nota</Button>
            : <Button disabled={!file || file === row.note_file || m.isPending} onClick={() => m.mutate({ id: row.id, patch: { note_file: file }, sameXml: row.itemCount > 1 ? row.access_key : undefined })}>Atribuir</Button>}
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
  const list = useQuery({ queryKey: ["fleet-item-accounts"], queryFn: async () => ((await supabase.from("fleet_item_accounts").select("*").order("cc_code").order("description")).data ?? []) as Tables<"fleet_item_accounts">[] });
  const clients = useQuery({ queryKey: ["fleet-rateio-clients"], queryFn: async () => ((await supabase.from("clients").select("id, name, cc_prefix")).data ?? []) as RateioClient[] });
  // NFD separa os acentos; o filtro tira acentos, espaços e pontuação.
  const plainName = (s: string) => s.toUpperCase().normalize("NFD").replace(/[^A-Z0-9]/g, "");
  const systemClient = (a: { cc_code: string; description: string | null }) =>
    (clients.data ?? []).find((c) => a.description && plainName(c.name) === plainName(a.description))?.name
    ?? (clients.data ?? []).find((c) => c.cc_prefix && a.cc_code.startsWith(c.cc_prefix))?.name ?? null;
  const done = () => { qc.invalidateQueries({ queryKey: ["fleet-item-accounts"] }); setForm({ id: "", cc: "", item: "", description: "" }); };
  const save = useMutation({
    mutationFn: async () => {
      const row = { cc_code: form.cc.replace(/\s/g, ""), item_account: form.item.trim(), description: form.description.trim() || null, updated_at: new Date().toISOString() };
      if (!row.cc_code || !row.item_account) throw new Error("Preencha o centro de custo e o item conta.");
      if (!row.description) throw new Error("Preencha o rateio (nome do cliente).");
      const { error } = form.id ? await supabase.from("fleet_item_accounts").update(row).eq("id", form.id) : await supabase.from("fleet_item_accounts").insert(row);
      if (error) throw error.code === "23505" ? new Error("Este rateio já está cadastrado com este centro de custo.") : error;
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
      <p className="text-sm text-muted-foreground">O item conta de cada parte do rateio vem do centro de custo dela. Quando o mesmo centro de custo aparece em mais de uma linha (ex.: 1001999 Indústria e Pátio), vale a linha cujo rateio tem o nome do cliente. Um CC de 4 dígitos vale para todos os CC do cliente.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="eq-desc">Rateio</Label><Input id="eq-desc" className="w-64" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="eq-cc">Centro de custo</Label><Input id="eq-cc" className="w-40" value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="eq-item">Item conta</Label><Input id="eq-item" className="w-32" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} /></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{form.id ? "Salvar" : "Adicionar"}</Button>
        {form.id && <Button variant="ghost" onClick={() => setForm({ id: "", cc: "", item: "", description: "" })}>Cancelar</Button>}
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Rateio</TableHead><TableHead>Centro de custo</TableHead><TableHead>Item conta</TableHead><TableHead>Cliente no sistema</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
          <TableBody>
            {!(list.data ?? []).length ? (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground">{list.isLoading ? "Carregando..." : "Nenhuma equivalência cadastrada."}</TableCell></TableRow>
            ) : (list.data ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.description ?? "—"}</TableCell>
                <TableCell>{a.cc_code}</TableCell>
                <TableCell>{a.item_account}</TableCell>
                <TableCell>{systemClient(a) ?? <span className="text-muted-foreground">—</span>}</TableCell>
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

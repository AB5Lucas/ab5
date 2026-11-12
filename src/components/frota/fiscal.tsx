import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FolderCog, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableRow, TableHeader } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { applyColumnFilters, FilterHead, rowsForColumn, type ColumnDef, type ColumnFilters, type ColumnSort } from "@/components/column-filter";
import { baseFolderPath } from "@/lib/fleet-notes";
import { DEFAULT_INVOICE_FOLDER, invoiceFortnight, invoiceNumber } from "@/lib/fleet-invoices";
import { fleetNoteLink, syncFleetInvoicesNow } from "@/lib/fleet-notes.functions";
import type { Tables } from "@/integrations/supabase/types";

type Invoice = Tables<"fleet_invoices">;
type Row = Invoice & { numberShown: string; month: number | null; year: number | null; fortnight: 1 | 2 | null };

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const brDate = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const QUINZENA = (f: 1 | 2 | null) => (f ? `${f}ª QUINZENA` : "—");

/** Frota › Abastecimento › Fiscal: faturas quinzenais do posto (PDF na pasta 03 FATURAS). */
export function FleetFiscal() {
  const qc = useQueryClient();
  const [folderOpen, setFolderOpen] = useState(false);
  const [filters, setFilters] = useState<ColumnFilters>({});
  const [sort, setSort] = useState<ColumnSort>(null);
  const settings = useQuery({ queryKey: ["fleet-settings"], queryFn: async () => Object.fromEntries(((await supabase.from("fleet_settings").select("key, value")).data ?? []).map((s) => [s.key, s.value])) as Record<string, string | null> });
  const invoices = useQuery({ queryKey: ["fleet-invoices"], queryFn: async () => (await supabase.from("fleet_invoices").select("*").order("issued_on")).data ?? [] });

  const syncFn = useServerFn(syncFleetInvoicesNow);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: (r) => {
      toast.success(`${r.saved} fatura(s) de ${r.files} PDF na pasta.`);
      r.errors.slice(0, 4).forEach((e) => toast.warning(e));
      qc.invalidateQueries({ queryKey: ["fleet-invoices"] });
      qc.invalidateQueries({ queryKey: ["fleet-settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const paid = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase.from("fleet_invoices").update({ paid: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet-invoices"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const linkFn = useServerFn(fleetNoteLink);
  async function openPdf(itemId: string | null) {
    if (!itemId) { toast.error("Arquivo não encontrado. Clique em Ler pasta."); return; }
    try { const url = await linkFn({ data: { itemId } }); if (url) window.open(url, "_blank", "noopener"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível abrir a fatura."); }
  }

  const rows = useMemo<Row[]>(() => (invoices.data ?? []).map((i) => ({
    ...i, numberShown: i.number ? invoiceNumber(i.number) : i.file_name, ...invoiceFortnight(i.period_from, i.issued_on),
  })), [invoices.data]);
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { key: "fatura", label: "Fatura fechamento", values: (r) => [r.numberShown], sort: (r) => r.numberShown },
    { key: "emissao", label: "DT emissão", values: (r) => [brDate(r.issued_on)], sort: (r) => r.issued_on },
    { key: "mes", label: "Mês cobrança", align: "right", values: (r) => [r.month ? String(r.month) : ""], sort: (r) => (r.year && r.month ? r.year * 100 + r.month : null) },
    { key: "quinzena", label: "Quinzena cobrança", values: (r) => [r.fortnight ? QUINZENA(r.fortnight) : ""] },
    { key: "nf", label: "R$ NF", align: "right", values: (r) => [brl(r.total)], sort: (r) => (r.total == null ? null : Number(r.total)) },
    { key: "vencimento", label: "DT vencimento", values: (r) => [brDate(r.due_on)], sort: (r) => r.due_on },
    { key: "pago", label: "Pago?", values: (r) => [r.paid ? "SIM" : "NÃO"] },
  ], []);
  const shown = useMemo(() => applyColumnFilters(rows, columns, filters, sort), [rows, columns, filters, sort]);
  const lastRead = settings.data?.["synced:faturas"];
  const folder = settings.data?.["invoice_folder"] ?? DEFAULT_INVOICE_FOLDER;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="outline" onClick={() => setFolderOpen(true)}><FolderCog className="h-4 w-4" /> Pasta</Button>
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} /> {sync.isPending ? "Lendo pasta..." : "Ler pasta"}
        </Button>
        <p className="pb-2 text-xs text-muted-foreground">
          Faturas do posto em PDF na pasta {folder} (e nas pastas de cada ano). {lastRead ? `Lida em ${new Date(lastRead).toLocaleString("pt-BR")}.` : "Ainda não lida: clique em Ler pasta."}
        </p>
      </div>
      {Object.keys(filters).length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Filtro nas colunas: {Object.keys(filters).map((k) => columns.find((c) => c.key === k)?.label).filter(Boolean).join(", ")}.
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setFilters({})}>Limpar filtros das colunas</Button>
        </div>
      )}
      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              {columns.map((c) => <FilterHead key={c.key} column={c} rows={rowsForColumn(rows, columns, filters, c.key)} filters={filters} setFilters={setFilters} sort={sort} setSort={setSort} />)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.isLoading ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">Carregando...</TableCell></TableRow>
              : !shown.length ? <TableRow><TableCell colSpan={7} className="text-muted-foreground">{rows.length ? "Nenhuma fatura com esses filtros." : "Nenhuma fatura lida. Clique em Ler pasta."}</TableCell></TableRow>
              : shown.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" title={`Abrir ${r.file_name}`} onClick={() => openPdf(r.item_id)}>{r.numberShown}</button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{brDate(r.issued_on)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.month ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap" title={r.period_from ? `Período faturado: ${brDate(r.period_from)} a ${brDate(r.period_to)}` : undefined}>{QUINZENA(r.fortnight)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.total)}</TableCell>
                  <TableCell className="whitespace-nowrap">{brDate(r.due_on)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" disabled={paid.isPending}
                      className={`h-6 px-2 text-xs ${r.paid ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-400" : "border-destructive/40 text-destructive"}`}
                      title={r.paid ? "Marcar como não paga" : "Marcar como paga"} onClick={() => paid.mutate({ id: r.id, value: !r.paid })}>
                      {r.paid ? "SIM" : "NÃO"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
          {shown.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>{shown.length} fatura(s) · {shown.filter((r) => !r.paid).length} não paga(s)</TableCell>
                <TableCell className="text-right tabular-nums">{brl(shown.reduce((s, r) => s + Number(r.total ?? 0), 0))}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      <FolderDialog open={folderOpen} value={folder} onClose={() => setFolderOpen(false)} />
    </div>
  );
}

function FolderDialog({ open, value, onClose }: { open: boolean; value: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  useEffect(() => { if (open) setText(value); }, [open]);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fleet_settings").upsert({ key: "invoice_folder", value: text.trim() ? baseFolderPath(text) : DEFAULT_INVOICE_FOLDER, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pasta salva."); qc.invalidateQueries({ queryKey: ["fleet-settings"] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Pasta das faturas</DialogTitle>
          <DialogDescription>Cole o caminho da pasta (do computador ou do SharePoint). Os PDF podem ficar nela ou em pastas de ano (ex.: "2026").</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="invoice-folder">Pasta das faturas</Label>
          <Input id="invoice-folder" value={text} onChange={(e) => setText(e.target.value)} placeholder={DEFAULT_INVOICE_FOLDER} />
          {text.trim() && <p className="text-xs text-muted-foreground">SharePoint: {baseFolderPath(text)}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SC_IMPORT_COLUMNS, SC_IMPORT_RATEIO, parseScImport, type ImportWork, type ImportedRow } from "@/lib/sc-import";
import { SC_UNITS } from "@/lib/purchase-requests";

export type ScImportItem = Omit<ImportedRow, "line" | "errors" | "warnings">;

/** Modelo: aba Itens com as colunas da SC e aba Listas com as unidades e os serviços do cliente. */
async function downloadTemplate(works: ImportWork[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[...SC_IMPORT_COLUMNS]]);
  ws["!cols"] = [6, 8, 12, 50, 14, 30, 40, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, "Itens");
  const names = ["Rateio geral", ...works.map((w) => w.name)];
  const n = Math.max(SC_UNITS.length, names.length);
  const lists = [["Un. medida", "Centro de custo"], ...Array.from({ length: n }, (_, i) => [SC_UNITS[i] ?? "", names[i] ?? ""])];
  const wl = XLSX.utils.aoa_to_sheet(lists);
  wl["!cols"] = [{ wch: 12 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wl, "Listas");
  XLSX.writeFile(wb, "Modelo itens SC.xlsx");
}

/** Botões Importar planilha + Baixar modelo, e a prévia antes de acrescentar os itens. */
export function ScImportButtons({ works, workLabel, onImport }: {
  works: ImportWork[]; workLabel: (id: string) => string; onImport: (items: ScImportItem[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ name: string; rows: ImportedRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async (file: File) => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, codepage: 65001 });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      if (!sheet) throw new Error("Planilha vazia.");
      // raw: números ficam números (Qtd/Verba); o resto como texto.
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
      const res = parseScImport(matrix, works);
      if (res.error) throw new Error(res.error);
      if (!res.rows.length) throw new Error("Nenhum item encontrado na planilha.");
      setPreview({ name: file.name, rows: res.rows });
    } catch (e) {
      toast.error((e as Error).message || "Não consegui ler a planilha.");
    } finally {
      setBusy(false);
    }
  };
  const ok = preview?.rows.filter((r) => !r.errors.length) ?? [];
  const bad = (preview?.rows.length ?? 0) - ok.length;
  return (
    <>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        <FileSpreadsheet className="h-4 w-4" /> {busy ? "Lendo…" : "Importar planilha"}
      </Button>
      <input ref={input} type="file" className="hidden" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
      <Button variant="ghost" size="sm" onClick={() => void downloadTemplate(works).catch((e: Error) => toast.error(e.message))}>
        <Download className="h-4 w-4" /> Baixar modelo
      </Button>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar itens</DialogTitle>
            <DialogDescription>
              {preview?.name}: {preview?.rows.length} linha(s). {bad ? `${bad} com erro não entram; corrija a planilha e importe de novo se precisar.` : "Todas prontas."}
              {" "}Os itens são acrescentados aos da SC; depois clique em Salvar itens.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead><TableHead>Qtd</TableHead><TableHead>Un.</TableHead><TableHead className="min-w-56">Descrição</TableHead>
                  <TableHead>Verba (R$)</TableHead><TableHead>Observações</TableHead><TableHead>Centro de custo</TableHead><TableHead>CC</TableHead><TableHead className="min-w-48">Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview?.rows.map((r) => (
                  <TableRow key={r.line} className={r.errors.length ? "bg-destructive/10" : undefined}>
                    <TableCell>{r.line}</TableCell>
                    <TableCell>{r.quantity}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="whitespace-pre-wrap">{r.description || "—"}</TableCell>
                    <TableCell>{r.budget || "—"}</TableCell>
                    <TableCell className="max-w-40 truncate" title={r.notes}>{r.notes || "—"}</TableCell>
                    <TableCell>{r.work_id === SC_IMPORT_RATEIO ? "Rateio geral" : workLabel(r.work_id)}</TableCell>
                    <TableCell className="font-mono">{r.cc || "auto"}</TableCell>
                    <TableCell>
                      {r.errors.map((m) => <div key={m} className="text-destructive">{m}</div>)}
                      {r.warnings.map((m) => <div key={m} className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="h-3 w-3 shrink-0" /> {m}</div>)}
                      {!r.errors.length && !r.warnings.length && <span className="text-emerald-600 dark:text-emerald-400">OK</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Cancelar</Button>
            <Button disabled={!ok.length} onClick={() => {
              onImport(ok.map(({ line: _l, errors: _e, warnings: _w, ...it }) => it));
              toast.success(`${ok.length} item(ns) acrescentado(s). Confira e clique em Salvar itens.`);
              setPreview(null);
            }}>Acrescentar {ok.length} item(ns)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

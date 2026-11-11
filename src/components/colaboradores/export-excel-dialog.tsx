import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_EXPORT_KEYS, exportRows, orderedColumns, type ExportColumn, type ExportCtx } from "@/lib/collaborator-export";

const ORDER_KEY = "colaboradores-excel-ordem";
const SELECTED_KEY = "colaboradores-excel-colunas";
const load = (k: string): string[] | null => { try { const v = JSON.parse(localStorage.getItem(k) ?? "null"); return Array.isArray(v) ? v : null; } catch { return null; } };
const save = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } };

/** Exporta a lista filtrada de colaboradores: escolhe as colunas e arrasta para mudar a ordem. */
export function ExportCollaboratorsDialog({ rows, ctx, isAdmin, disabled }: { rows: any[]; ctx: ExportCtx; isAdmin: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<ExportColumn[]>(() => orderedColumns(null, isAdmin));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(DEFAULT_EXPORT_KEYS));
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Lembra a última escolha neste navegador.
  useEffect(() => {
    if (!open) return;
    setColumns(orderedColumns(load(ORDER_KEY), isAdmin));
    setSelected(new Set(load(SELECTED_KEY) ?? DEFAULT_EXPORT_KEYS));
  }, [open, isAdmin]);

  const toggle = (key: string) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const move = (from: string, to: string) => {
    if (from === to) return;
    setColumns((cols) => {
      const list = [...cols];
      const a = list.findIndex((c) => c.key === from);
      const [item] = list.splice(a, 1);
      list.splice(list.findIndex((c) => c.key === to), 0, item!);
      return list;
    });
  };
  const nudge = (key: string, dir: -1 | 1) => setColumns((cols) => {
    const i = cols.findIndex((c) => c.key === key); const j = i + dir;
    if (j < 0 || j >= cols.length) return cols;
    const list = [...cols]; [list[i], list[j]] = [list[j]!, list[i]!]; return list;
  });

  async function exportFile() {
    if (!selected.size) { toast.error("Marque ao menos uma coluna."); return; }
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const aoa = exportRows(rows, columns, selected, ctx);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = aoa[0]!.map((_, i) => ({ wch: Math.min(45, Math.max(10, ...aoa.map((r) => String(r[i] ?? "").length + 2))) }));
      const salaryCol = columns.filter((c) => selected.has(c.key)).findIndex((c) => c.key === "salary");
      if (salaryCol >= 0) for (let r = 1; r < aoa.length; r++) { const cell = ws[XLSX.utils.encode_cell({ r, c: salaryCol })]; if (cell && typeof cell.v === "number") cell.z = '"R$" #,##0.00'; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Colaboradores");
      XLSX.writeFile(wb, `colaboradores-${new Date().toISOString().slice(0, 10)}.xlsx`);
      save(ORDER_KEY, columns.map((c) => c.key));
      save(SELECTED_KEY, [...selected]);
      toast.success(`${rows.length} colaborador(es) exportado(s).`);
      setOpen(false);
    } catch {
      toast.error("Não foi possível gerar o Excel. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <FileSpreadsheet className="h-4 w-4" /> Exportar Excel
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Exportar Excel</DialogTitle>
            <DialogDescription>
              {rows.length} colaborador(es) da lista filtrada. Marque as colunas e arraste para mudar a ordem.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border rounded-md border border-border">
            {columns.map((c, i) => (
              <li
                key={c.key}
                draggable
                onDragStart={(e) => { setDragging(c.key); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); setOver(c.key); }}
                onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
                onDrop={(e) => { e.preventDefault(); if (dragging) move(dragging, c.key); setDragging(null); setOver(null); }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                className={`flex items-center gap-2 px-2 py-1.5 text-sm ${dragging === c.key ? "opacity-40" : ""} ${over === c.key && dragging !== c.key ? "bg-accent" : ""}`}
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />
                <Checkbox id={`exp-${c.key}`} checked={selected.has(c.key)} onCheckedChange={() => toggle(c.key)} />
                <label htmlFor={`exp-${c.key}`} className={`flex-1 cursor-pointer ${selected.has(c.key) ? "" : "text-muted-foreground"}`}>{c.label}</label>
                <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{selected.has(c.key) ? columns.filter((x, j) => j <= i && selected.has(x.key)).length : ""}</span>
                <button type="button" className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0} onClick={() => nudge(c.key, -1)} aria-label={`Subir ${c.label}`}>↑</button>
                <button type="button" className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === columns.length - 1} onClick={() => nudge(c.key, 1)} aria-label={`Descer ${c.label}`}>↓</button>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={exportFile} disabled={busy || !rows.length}>{busy ? "Gerando..." : `Exportar ${selected.size} coluna(s)`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateRangePicker, type DayRange } from "@/components/date-range-picker";

const STATUS_LABEL: Record<string, string> = {
  folga: "Folga", atestado: "Atestado", ferias: "Férias", medico: "Médico", afastado: "Afastado", falta: "Falta",
  interjornada: "Interjornada", licenca: "Licença", abono: "Abono", aso: "ASO", treinamento: "Treinamento", personalizada: "Treinamento",
};
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Exportar a Programação: escolhe o período no calendário e baixa um Excel com cada dia, separado por obra
 * (cliente da Programação) com os colaboradores embaixo (função e serviço); depois os quadros (folga, atestado…).
 */
export function ScheduleExportButton({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DayRange>({ from: date, to: date });
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const days = await fetchAll<{ id: string; schedule_date: string }>((a, b) => supabase.from("daily_schedules").select("id, schedule_date")
        .gte("schedule_date", range.from).lte("schedule_date", range.to).order("schedule_date").range(a, b));
      if (!days.length) { toast.info("Nenhuma programação no período"); return; }
      const ids = days.map((d) => d.id);
      const allocs: { schedule_id: string; work_id: string | null; collaborator_id: string | null; position_id: string | null; sort_order: number | null }[] = [];
      const boxes: { schedule_id: string; box_key: string; collaborator_id: string; sort_order: number | null }[] = [];
      for (const part of chunks(ids, 40)) {
        allocs.push(...await fetchAll<any>((a, b) => supabase.from("daily_allocations").select("schedule_id, work_id, collaborator_id, position_id, sort_order").in("schedule_id", part).order("id").range(a, b)));
        boxes.push(...await fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("schedule_id, box_key, collaborator_id, sort_order").in("schedule_id", part).order("id").range(a, b)));
      }
      const [works, people, positions, clients] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id, clients(name)").order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("collaborators").select("id, full_name, position_id").order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("positions").select("id, name").order("id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("clients").select("id, name").order("id").range(a, b)),
      ]);
      const workBy = new Map(works.map((w) => [w.id, w]));
      const personBy = new Map(people.map((p) => [p.id, p]));
      const posBy = new Map(positions.map((p) => [p.id, p.name as string]));
      const clientBy = new Map(clients.map((c) => [c.id, c.name as string]));
      const boxLabel = (k: string) => {
        if (k.startsWith("integracao")) { const c = k.split(":")[1]; return `Integração${c && clientBy.get(c) ? ` - ${clientBy.get(c)}` : ""}`; }
        return STATUS_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
      };
      const name = (id: string | null) => (id ? personBy.get(id)?.full_name ?? "—" : "—");
      const role = (id: string | null, pos: string | null) => posBy.get(pos ?? "") ?? posBy.get(personBy.get(id ?? "")?.position_id ?? "") ?? "";
      const byName = (a: { n: string }, b: { n: string }) => a.n.localeCompare(b.n, "pt-BR");

      const rows: (string | number)[][] = [["Data", "Obra", "Colaborador", "Função", "Serviço"]];
      const bold: number[] = [];
      for (const d of days) {
        const wd = WEEKDAY[new Date(`${d.schedule_date}T12:00:00`).getDay()];
        bold.push(rows.length);
        rows.push([`${br(d.schedule_date)} (${wd})`]);
        const groups = new Map<string, { n: string; role: string; svc: string }[]>();
        for (const a of allocs.filter((x) => x.schedule_id === d.id && x.collaborator_id)) {
          const w = workBy.get(a.work_id ?? "");
          const obra = w?.clients?.name ?? w?.name ?? "Sem obra";
          const list = groups.get(obra) ?? []; groups.set(obra, list);
          list.push({ n: name(a.collaborator_id), role: role(a.collaborator_id, a.position_id), svc: w?.name ?? "" });
        }
        const boxGroups = new Map<string, { n: string; role: string; svc: string }[]>();
        for (const b of boxes.filter((x) => x.schedule_id === d.id)) {
          const k = boxLabel(b.box_key);
          const list = boxGroups.get(k) ?? []; boxGroups.set(k, list);
          list.push({ n: name(b.collaborator_id), role: role(b.collaborator_id, null), svc: "" });
        }
        const emit = (label: string, list: { n: string; role: string; svc: string }[]) => {
          bold.push(rows.length);
          rows.push(["", `${label} (${list.length})`]);
          for (const p of list.sort(byName)) rows.push(["", "", p.n, p.role, p.svc]);
        };
        for (const [obra, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))) emit(obra, list);
        for (const [k, list] of [...boxGroups.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))) emit(k, list);
        if (!groups.size && !boxGroups.size) rows.push(["", "Sem escalação"]);
        rows.push([]);
      }
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 22 }, { wch: 34 }, { wch: 38 }, { wch: 34 }, { wch: 40 }];
      for (const r of bold) for (const c of [0, 1]) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = { font: { bold: true } };
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Programação");
      XLSX.writeFile(wb, `Programação ${br(range.from).replace(/\//g, "-")}${range.to !== range.from ? ` a ${br(range.to).replace(/\//g, "-")}` : ""}.xlsx`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar");
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setRange({ from: date, to: date }); setOpen(true); }}>
        <Download className="h-4 w-4" /> Exportar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar programação</DialogTitle>
            <DialogDescription>Escolha o primeiro e o último dia. A planilha lista cada dia, separado por obra, com os colaboradores embaixo.</DialogDescription>
          </DialogHeader>
          <DateRangePicker value={range} onChange={setRange} label="Período" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={busy} onClick={() => void run()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

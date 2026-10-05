import { useQuery } from "@tanstack/react-query";
import { ArrowRight, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const add = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const dow = (s: string) => new Date(`${s}T12:00:00`).getDay();
const br = (s: string) => `${s.slice(8)}/${s.slice(5, 7)}`;
const short = (n: string) => n.trim().split(/\s+/).slice(0, 2).join(" ");
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Quem precisa passar o carro para outro motorista no próximo dia de escala. */
export function VehicleHandover() {
  const today = iso(new Date());
  const q = useQuery({
    queryKey: ["vehicle-handover", today],
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicle_schedules")
        .select("schedule_date, vehicle_id, driver_id, vehicles(plate, model), collaborators!vehicle_schedules_driver_id_fkey(full_name)")
        .gte("schedule_date", add(today, -10))
        .lte("schedule_date", add(today, 4));
      const rows = (data ?? []) as any[];
      const at = (v: string, d: string) => rows.find((r) => r.vehicle_id === v && r.schedule_date === d && r.driver_id);
      const out: { plate: string; from: string; to: string; date: string }[] = [];
      for (const cur of rows.filter((r) => r.schedule_date === today && r.driver_id)) {
        let d = add(today, 1);
        let next = at(cur.vehicle_id, d);
        // Fim de semana vazio: procura domingo e depois segunda.
        while (!next && (dow(d) === 6 || dow(d) === 0)) {
          d = add(d, 1);
          next = at(cur.vehicle_id, d);
        }
        if (next?.driver_id === cur.driver_id) continue;
        out.push({
          plate: cur.vehicles?.plate ?? "—",
          from: short(cur.collaborators?.full_name ?? "—"),
          to: next ? short(next.collaborators?.full_name ?? "—") : "-",
          date: d,
        });
      }
      // Carros sem escalação hoje (ex.: pickups paradas) que terão motorista no próximo dia.
      const vehiclesToday = new Set(rows.filter((r) => r.schedule_date === today && r.driver_id).map((r) => r.vehicle_id));
      const others = [...new Set(rows.map((r) => r.vehicle_id as string))].filter((v) => !vehiclesToday.has(v));
      for (const v of others) {
        let d = add(today, 1);
        let next = at(v, d);
        while (!next && (dow(d) === 6 || dow(d) === 0)) {
          d = add(d, 1);
          next = at(v, d);
        }
        if (!next) continue;
        const last = rows
          .filter((r) => r.vehicle_id === v && r.driver_id && r.schedule_date < today)
          .sort((a, b) => b.schedule_date.localeCompare(a.schedule_date))[0];
        if (last?.driver_id === next.driver_id) continue;
        out.push({
          plate: next.vehicles?.plate ?? "—",
          from: last ? `${short(last.collaborators?.full_name ?? "—")} (sem escala hoje)` : "Sem escalação",
          to: short(next.collaborators?.full_name ?? "—"),
          date: d,
        });
      }
      return out.sort((a, b) => a.from.localeCompare(b.from, "pt-BR"));
    },
  });
  const list = q.data ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound className="h-4 w-4" /> Trocas
          {list.length > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{list.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3 text-xs">
      <p className="mb-1 flex items-center gap-1 font-display font-semibold uppercase tracking-wide">
        <KeyRound className="h-3.5 w-3.5" /> Troca de carros
      </p>
      {q.isLoading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : list.length === 0 ? (
        <p className="text-muted-foreground">Ninguém precisa trocar de carro.</p>
      ) : (
        <ul className="space-y-1">
          {list.map((r, i) => (
            <li key={i} className="flex items-center gap-1">
              <span className="font-medium">{r.from}</span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <span className={r.to === "-" ? "text-muted-foreground" : "font-medium"}>{r.to}</span>
              <span className="ml-auto text-muted-foreground">{r.plate} · {WD[dow(r.date)]} {br(r.date)}</span>
            </li>
          ))}
        </ul>
      )}
      </PopoverContent>
    </Popover>
  );
}

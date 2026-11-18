import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Plus, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchSelect } from "@/components/search-select";
import { cityHolidayDate, normCity, type CityHoliday } from "@/lib/holidays";

const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const br = (d: string) => `${d.split("-").reverse().join("/")} (${WEEK[new Date(`${d}T12:00:00Z`).getUTCDay()]})`;
const KIND: Record<string, string> = { nacional: "Nacional", estadual: "Estadual (SP)", municipal: "Municipal", troca: "Troca", manual: "Manual" };
const ALL = "__all__";

/**
 * Configurações › Feriados: nacionais (+09/07 SP) e os automáticos do catálogo (Mogi Guaçu) entram sozinhos todo ano
 * (holidays_sync_year, também no job diário); troca de dia para todos ou para um cliente (holiday_move); exceções por
 * cliente (client_holidays); catálogo de feriados das cidades dos clientes (avisam na Programação quando há equipe).
 */
export function HolidaysSettings({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [moving, setMoving] = useState<{ date: string; name: string; clientId?: string } | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [moveScope, setMoveScope] = useState(ALL);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["holidays"] }); qc.invalidateQueries({ queryKey: ["client-holidays"] }); qc.invalidateQueries({ queryKey: ["schedule-alerts"] }); };

  const holidays = useQuery({
    queryKey: ["holidays", year],
    queryFn: async () => (await supabase.from("holidays").select("*").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).order("date")).data ?? [],
  });
  const clients = useQuery({ queryKey: ["hol-clients"], queryFn: async () => (await supabase.from("clients").select("id, name, city").order("name")).data ?? [] });
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const clientHol = useQuery({
    queryKey: ["client-holidays", year],
    queryFn: async () => (await supabase.from("client_holidays").select("*").gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).order("date")).data ?? [],
  });
  const catalog = useQuery({ queryKey: ["city-holiday-catalog"], queryFn: async () => ((await supabase.from("city_holiday_catalog").select("*").order("city").order("month").order("day")).data ?? []) as (CityHoliday & { id: string })[] });

  const sync = useMutation({
    mutationFn: async () => {
      let n = 0;
      for (const y of [year, year + 1]) { const { data, error } = await supabase.rpc("holidays_sync_year", { y }); if (error) throw error; n += Number(data ?? 0); }
      return n;
    },
    onSuccess: (n) => { toast.success(n ? `${n} feriado(s) incluído(s)` : "Feriados já estavam em dia"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const add = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !date) throw new Error("Informe o nome e a data do feriado.");
      const { error } = await supabase.from("holidays").insert({ name: name.trim(), date, kind: "manual" });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Feriado cadastrado"); setName(""); setDate(""); refresh(); },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "Já existe feriado nesse dia" : e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("holiday_remove", { _id: id }); if (error) throw error; },
    onSuccess: () => { toast.success("Feriado removido"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const move = useMutation({
    mutationFn: async () => {
      if (!moving || !moveTo) throw new Error("Escolha o novo dia.");
      const { error } = await supabase.rpc("holiday_move", { _date: moving.date, _new_date: moveTo, _client_id: moveScope === ALL ? null : moveScope });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Feriado trocado"); setMoving(null); setMoveTo(""); setMoveScope(ALL); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeClientHol = useMutation({
    mutationFn: async (r: { client_id: string; date: string }) => {
      const { error } = await supabase.from("client_holidays").delete().eq("client_id", r.client_id).eq("date", r.date);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Exceção removida"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="block">Ano</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{[-1, 0, 1, 2].map((d) => { const y = new Date().getFullYear() + d; return <SelectItem key={y} value={String(y)}>{y}</SelectItem>; })}</SelectContent>
          </Select>
        </div>
        {canWrite && <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}><RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} /> {sync.isPending ? "Sincronizando…" : "Sincronizar"}</Button>}
        <p className="text-xs text-muted-foreground">Nacionais, 09/07 (SP) e os de Mogi Guaçu entram sozinhos todo ano (também na leitura diária). Removido ou trocado não volta.</p>
      </div>

      {canWrite && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-1"><Label htmlFor="holiday-name">Nome</Label><Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Ponte de feriado" className="w-64" /></div>
          <div className="space-y-1"><Label htmlFor="holiday-date">Data</Label><Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" /></div>
          <Button type="submit" disabled={add.isPending}><Plus className="h-4 w-4" /> Adicionar feriado para todos</Button>
        </form>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead className="w-28" /></TableRow></TableHeader>
          <TableBody>
            {(holidays.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">{holidays.isLoading ? "Carregando..." : "Nenhum feriado no ano. Clique em Sincronizar."}</TableCell></TableRow>}
            {(holidays.data ?? []).map((h) => (
              <TableRow key={h.id}>
                <TableCell className="whitespace-nowrap">{br(h.date)}</TableCell>
                <TableCell className="font-medium">{h.name}</TableCell>
                <TableCell><Badge variant="secondary">{KIND[h.kind] ?? h.kind}</Badge></TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {canWrite && (
                    <>
                      <Button variant="ghost" size="icon" title="Trocar por outro dia (todos ou um cliente)" onClick={() => setMoving({ date: h.date, name: h.name })}><ArrowRightLeft className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" title="Remover" onClick={() => remove.mutate(h.id)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Exceções por cliente</h3>
        <p className="text-xs text-muted-foreground">Feriado só daquele cliente (cadastrado pelo aviso da Programação ou por troca) ou feriado geral em que o cliente trabalha.</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Data</TableHead><TableHead>Situação</TableHead><TableHead>Nome</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
            <TableBody>
              {(clientHol.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nenhuma exceção no ano.</TableCell></TableRow>}
              {(clientHol.data ?? []).map((r) => (
                <TableRow key={`${r.client_id}|${r.date}`}>
                  <TableCell>{clientName.get(r.client_id) ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{br(r.date)}</TableCell>
                  <TableCell>{r.is_holiday ? <Badge>Feriado do cliente</Badge> : <Badge variant="outline">Trabalhado</Badge>}</TableCell>
                  <TableCell>{r.name ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {canWrite && r.is_holiday && <Button variant="ghost" size="icon" title="Trocar por outro dia" onClick={() => { setMoving({ date: r.date, name: r.name ?? "Feriado", clientId: r.client_id }); setMoveScope(r.client_id); }}><ArrowRightLeft className="h-4 w-4" /></Button>}
                    {canWrite && <Button variant="ghost" size="icon" title="Remover" onClick={() => removeClientHol.mutate(r)}><Trash2 className="h-4 w-4" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <CityCatalog canWrite={canWrite} year={year} rows={catalog.data ?? []} cities={[...new Set((clients.data ?? []).map((c) => c.city).filter((c): c is string => !!c))]} />

      <Dialog open={!!moving} onOpenChange={(o) => !o && setMoving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trocar feriado</DialogTitle>
            <DialogDescription>{moving ? `${moving.name} · ${br(moving.date)}` : ""} — o dia original passa a ser dia normal e o novo dia vira feriado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="move-to">Novo dia</Label><Input id="move-to" type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Vale para</Label>
              <SearchSelect value={moveScope} onChange={setMoveScope} searchPlaceholder="Digite o cliente"
                options={[...(moving?.clientId ? [] : [{ value: ALL, label: "Todos os clientes" }]), ...(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(null)}>Cancelar</Button>
            <Button disabled={move.isPending || !moveTo} onClick={() => move.mutate()}>Trocar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CityCatalog({ canWrite, year, rows, cities }: { canWrite: boolean; year: number; rows: (CityHoliday & { id: string })[]; cities: string[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ city: "", kind: "fixo", date: "", offset: "60", name: "", auto: false });
  const cityList = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of [...cities, ...rows.map((r) => r.city)]) if (!m.has(normCity(c))) m.set(normCity(c), c);
    return [...m.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [cities, rows]);
  const add = useMutation({
    mutationFn: async () => {
      if (!form.city || !form.name.trim()) throw new Error("Informe a cidade e o nome.");
      const [, m, d] = form.date.split("-").map(Number);
      if (form.kind === "fixo" && (!m || !d)) throw new Error("Informe o dia.");
      const { error } = await supabase.from("city_holiday_catalog").insert({
        city: form.city, name: form.name.trim(), auto: form.auto,
        month: form.kind === "fixo" ? m! : null, day: form.kind === "fixo" ? d! : null, easter_offset: form.kind === "pascoa" ? Number(form.offset) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Feriado da cidade cadastrado"); setForm((f) => ({ ...f, name: "", date: "" })); qc.invalidateQueries({ queryKey: ["city-holiday-catalog"] }); qc.invalidateQueries({ queryKey: ["schedule-alerts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("city_holiday_catalog").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["city-holiday-catalog"] }); qc.invalidateQueries({ queryKey: ["schedule-alerts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const byCity = new Map<string, (CityHoliday & { id: string })[]>();
  for (const r of rows) { const k = normCity(r.city); byCity.set(k, [...(byCity.get(k) ?? []), r]); }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Feriados das cidades dos clientes</h3>
      <p className="text-xs text-muted-foreground">
        Automático = entra para todos (Mogi Guaçu, sede). Os demais avisam na Programação quando há equipe escalada num cliente da cidade, para cadastrar só para o cliente ou ignorar.
        Fontes: listas de feriados do TJSP/CSM, TRT-15/TRT-3 e prefeituras — confira se a cidade mudar a lei.
      </p>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="block">Cidade</Label>
            <SearchSelect className="w-48" value={form.city} onChange={(v) => setForm((f) => ({ ...f, city: v }))} placeholder="Cidade" searchPlaceholder="Digite a cidade" options={cityList.map((c) => ({ value: c, label: c }))} />
          </div>
          <div className="space-y-1">
            <Label className="block">Data</Label>
            <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="fixo">Dia fixo</SelectItem><SelectItem value="pascoa">Pela Páscoa</SelectItem></SelectContent>
            </Select>
          </div>
          {form.kind === "fixo"
            ? <div className="space-y-1"><Label htmlFor="cat-date">Dia (o ano não importa)</Label><Input id="cat-date" type="date" className="w-44" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></div>
            : <div className="space-y-1"><Label htmlFor="cat-off">Dias após a Páscoa</Label><Input id="cat-off" className="w-28" inputMode="numeric" value={form.offset} onChange={(e) => setForm((f) => ({ ...f, offset: e.target.value.replace(/[^\d-]/g, "") }))} title="Corpus Christi = 60" /></div>}
          <div className="space-y-1"><Label htmlFor="cat-name">Nome</Label><Input id="cat-name" className="w-56" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div className="space-y-1"><Label className="block">Automático</Label><div className="flex h-10 items-center"><Switch checked={form.auto} onCheckedChange={(v) => setForm((f) => ({ ...f, auto: v }))} /></div></div>
          <Button disabled={add.isPending} onClick={() => add.mutate()}><Plus className="h-4 w-4" /> Incluir</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cityList.map((c) => {
          const list = byCity.get(normCity(c)) ?? [];
          return (
            <div key={c} className="rounded-md border border-border p-3">
              <p className="mb-1 text-sm font-medium">{c}</p>
              {!list.length && <p className="text-xs text-muted-foreground">Nenhum feriado municipal cadastrado.</p>}
              <ul className="space-y-1">
                {list.map((r) => {
                  const d = cityHolidayDate(r, year);
                  return (
                    <li key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 tabular-nums">{d ? br(d) : "—"}</span>
                      <span className="flex-1">{r.name}{r.easter_offset != null ? ` · Páscoa+${r.easter_offset}` : ""}{r.from_year ? ` · desde ${r.from_year}` : ""}</span>
                      {r.auto && <Badge variant="secondary" className="text-[10px]">automático</Badge>}
                      {canWrite && <button type="button" className="text-muted-foreground hover:text-destructive" title="Remover" onClick={() => remove.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

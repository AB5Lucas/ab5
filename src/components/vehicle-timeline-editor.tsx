import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, GripVertical, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SearchSelect } from "@/components/search-select";
import { IndustryCustomerSelect, industryKmOneWay, type IndustryCustomer } from "@/components/industry-customer-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cnhCovers } from "@/lib/logistics";
import {
  ALL_WORKS, EXTERNAL_KEY, KM_EXTERNAL, KM_SUZANO_LOCAL, MAINTENANCE_KEY, NONE, REVISION_KEY, SPECIAL_KEYS, SUZANO_LOCAL_KEY, WORK_PREFIX,
  dateRange, addDays, fmtDay, freightDriver, getFreights, setFreights, type CellForm, type Freight,
} from "@/components/vehicle-timeline-shared";

export type DriverInfo = { id: string; full_name: string; driver_license_category: string | null; driver_license_expiry: string | null };
type WorkLite = { id: string; name: string; client_id: string | null; clients?: { name: string } | null };

/** O que o editor precisa da página (cadastros já carregados e regras de km). */
export type EditorCtx = {
  clients: { id: string; name: string }[];
  works: WorkLite[];
  workById: Map<string, WorkLite>;
  drivers: DriverInfo[];
  people: { id: string; full_name: string }[];
  isIndustryClient: (id: string | null | undefined) => boolean;
  isAdmClient: (id: string | null | undefined) => boolean;
  clientKm: Map<string, number>;
  industryCustomers: IndustryCustomer[] | undefined;
  plateOf: (vehicleId: string) => string;
  /** Motorista → veículos em que está escalado no dia (todas as linhas do mês carregado). */
  driversOn: (date: string) => Map<string, Set<string>>;
};

const placeKmOneWay = (list: IndustryCustomer[] | undefined, place: string) => industryKmOneWay(list, place) ?? KM_EXTERNAL;
const placeExtraKm = (list: IndustryCustomer[] | undefined, place: string) => { const k = industryKmOneWay(list, place); return k != null ? k * 2 : KM_EXTERNAL; };

/** Ausências do dia (férias, atestado, folga) para avisar no editor. */
function useDayAbsences(date: string | null) {
  return useQuery({
    queryKey: ["transport-day-absences", date],
    enabled: !!date,
    staleTime: 60_000,
    queryFn: async () => {
      const d = date!;
      const [vac, med, off] = await Promise.all([
        supabase.from("vacations").select("collaborator_id").lte("start_date", d).gte("end_date", d),
        supabase.from("medical_leaves").select("collaborator_id").lte("start_date", d).gte("end_date", d),
        supabase.from("days_off").select("collaborator_id").lte("date", d).or(`end_date.gte.${d},and(end_date.is.null,date.eq.${d})`),
      ]);
      const out = new Map<string, string>();
      (off.data ?? []).forEach((r) => out.set(r.collaborator_id, "de folga"));
      (vac.data ?? []).forEach((r) => out.set(r.collaborator_id, "de férias"));
      (med.data ?? []).forEach((r) => out.set(r.collaborator_id, "com atestado"));
      return out;
    },
  });
}

/** Dias (do intervalo) em que o veículo já tem programação: serão sobrescritos. */
export function useExistingDays(vehicleIds: string[] | null, from: string, to: string) {
  return useQuery({
    queryKey: ["vehicle-existing-days", vehicleIds?.join(",") ?? "all", from, to],
    enabled: !!from && !!to && from <= to,
    queryFn: async () => {
      let q = supabase.from("vehicle_schedules").select("schedule_date, vehicle_id").gte("schedule_date", from).lte("schedule_date", to);
      if (vehicleIds) q = q.in("vehicle_id", vehicleIds);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Editor da célula da Transporte (fretes do dia). Tem o próprio estado: digitar aqui não redesenha a grade.
 * Avisos (não bloqueiam): CNH vencida ou que não cobre o veículo, motorista ausente no dia, motorista em outro veículo.
 */
export function VehicleCellEditor(props: {
  cell: { vehicleId: string; date: string; vehicleCnh: string | null; byWork: boolean } | null;
  initial: CellForm;
  ctx: EditorCtx;
  hasRow: boolean;
  saving: boolean;
  onClose: () => void;
  onRemove: () => void;
  onSave: (form: CellForm, targets: string[]) => void;
}) {
  const { cell, ctx } = props;
  const [form, setForm] = useState<CellForm>(props.initial);
  const [dragFreight, setDragFreight] = useState<number | null>(null);
  useEffect(() => { setForm(props.initial); }, [props.initial]);
  const byWork = !!cell?.byWork;
  const date = cell?.date ?? null;
  const absences = useDayAbsences(date);

  const driverOptions = useMemo(() => [{ value: NONE, label: "Sem motorista" }, ...ctx.drivers.map((d) => ({ value: d.id, label: d.full_name }))], [ctx.drivers]);
  const requesterOptions = useMemo(() => [{ value: NONE, label: "Sem solicitante" }, ...ctx.people.map((d) => ({ value: d.id, label: d.full_name }))], [ctx.people]);
  const pickDriverOptions = useMemo(() => [{ value: NONE, label: "Definir" }, ...ctx.drivers.map((d) => ({ value: d.id, label: d.full_name }))], [ctx.drivers]);
  const driverById = useMemo(() => new Map(ctx.drivers.map((d) => [d.id, d])), [ctx.drivers]);
  const freights = getFreights(form);

  const patchFreight = (i: number, patch: Partial<Freight>) => setForm((f) => setFreights(f, getFreights(f).map((x, j) => (j === i ? { ...x, ...patch } : x)), ctx.workById));
  const moveFreight = (from: number, to: number) => setForm((f) => {
    const list = getFreights(f);
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item!);
    return setFreights(f, list, ctx.workById);
  });
  const baseOf = (c: string) => (c.startsWith(WORK_PREFIX) ? ctx.workById.get(c.slice(WORK_PREFIX.length))?.client_id ?? NONE : c);
  const truckClient = baseOf(form.client_id);

  // "Repetir até": dias que já têm programação deste veículo serão sobrescritos.
  const repeatFrom = date && form.repeat_until > date ? addDays(date, 1) : "";
  const targets = repeatFrom ? dateRange(repeatFrom, form.repeat_until, form.skip_weekend) : [];
  const existing = useExistingDays(cell ? [cell.vehicleId] : null, repeatFrom, repeatFrom ? form.repeat_until : "");
  const overwritten = useMemo(() => {
    const t = new Set(targets);
    return (existing.data ?? []).map((r) => r.schedule_date).filter((d) => t.has(d)).sort();
  }, [existing.data, targets.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function clientOptions() {
    const list = ctx.clients;
    let idx = list.findIndex((c) => /^suzano$/i.test((c.name ?? "").trim()));
    if (idx < 0) idx = list.findIndex((c) => /suzano/i.test(c.name ?? ""));
    const out: ReactNode[] = [];
    list.forEach((c, i) => {
      out.push(<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>);
      if (i === idx) out.push(<SelectItem key={SUZANO_LOCAL_KEY} value={SUZANO_LOCAL_KEY}>SUZANO LOCAL</SelectItem>);
    });
    if (idx < 0) out.push(<SelectItem key={SUZANO_LOCAL_KEY} value={SUZANO_LOCAL_KEY}>SUZANO LOCAL</SelectItem>);
    return out;
  }

  const extraKm = (id: string) => (id === EXTERNAL_KEY ? KM_EXTERNAL : id === MAINTENANCE_KEY || id === REVISION_KEY ? 0 : id === SUZANO_LOCAL_KEY ? KM_SUZANO_LOCAL : ctx.clientKm.get(id) ?? 0);

  function freightKmText(fr: Freight, i: number) {
    const base = baseOf(fr.client);
    if (fr.client === NONE) return "";
    if (fr.client === MAINTENANCE_KEY) return "Manutenção: 0 km no dia, sem prêmio de motorista e sem prêmio de viagem.";
    if (fr.client === REVISION_KEY) return "Revisão: 0 km no dia, sem prêmio de motorista e sem prêmio de viagem.";
    if (fr.client === SUZANO_LOCAL_KEY) return `Suzano Local: ${KM_SUZANO_LOCAL} km de ida por viagem (${KM_SUZANO_LOCAL * 2} km ida e volta).`;
    if (fr.client === EXTERNAL_KEY) return `Externo: ${KM_EXTERNAL} km no dia, sem prêmio de motorista e sem prêmio de viagem.`;
    if (ctx.isAdmClient(base)) return i === 0 ? "ADM: digite o km de ida do dia; é ele que define a faixa do Prêmio Motorista." : `${extraKm(base)} km (ADM)`;
    if (ctx.isIndustryClient(base) && fr.place.trim()) {
      const known = industryKmOneWay(ctx.industryCustomers, fr.place) != null;
      return i === 0
        ? `Indústria com local: ${known ? `${placeKmOneWay(ctx.industryCustomers, fr.place)} km de ida (× 2)` : `${KM_EXTERNAL} km (local sem km cadastrado)`}, sem prêmio de motorista. O combustível vai para o CC da Indústria.`
        : `${placeExtraKm(ctx.industryCustomers, fr.place.trim())} km`;
    }
    return i === 0 ? `${ctx.clientKm.get(base) ?? 0} km de ida (distância cadastrada do cliente).` : `${extraKm(base)} km`;
  }

  /** Avisos do motorista do frete (não bloqueiam o salvar). */
  function driverWarnings(fr: Freight, i: number): string[] {
    if (!cell) return [];
    const id = freightDriver(fr, byWork, (x) => driverById.has(x));
    if (!id) return [];
    const d = driverById.get(id);
    const out: string[] = [];
    if (d?.driver_license_expiry && d.driver_license_expiry < cell.date) out.push(`CNH vencida em ${d.driver_license_expiry.split("-").reverse().join("/")}`);
    if (!d?.driver_license_category && cell.vehicleCnh) out.push("CNH sem categoria cadastrada");
    else if (d && !cnhCovers(d.driver_license_category, cell.vehicleCnh)) out.push(`CNH ${d.driver_license_category} não cobre a categoria ${cell.vehicleCnh} do veículo`);
    const away = absences.data?.get(id);
    if (away) out.push(`Motorista ${away} neste dia`);
    const others = [...(ctx.driversOn(cell.date).get(id) ?? [])].filter((v) => v !== cell.vehicleId);
    if (others.length) out.push(`Já é motorista de ${others.map(ctx.plateOf).join(", ")} neste dia`);
    // Mesmo motorista em dois fretes deste veículo é normal (vários fretes no dia): não avisa.
    void i;
    return out;
  }

  function renderFreight(fr: Freight, i: number, total: number) {
    const base = baseOf(fr.client);
    const warnings = driverWarnings(fr, i);
    return (
      <div key={i}
        onDragOver={(e) => { if (dragFreight !== null) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (dragFreight !== null && dragFreight !== i) moveFreight(dragFreight, i); setDragFreight(null); }}
        className={`space-y-2 rounded-md border p-2.5 ${dragFreight === i ? "border-primary opacity-60" : "border-border"}`}>
        <div className="flex items-center gap-2">
          {total > 1 && (
            <span draggable onDragStart={(e) => { setDragFreight(i); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDragFreight(null)}
              className="cursor-grab text-muted-foreground active:cursor-grabbing" title="Arraste para mudar a ordem" aria-label="Arrastar frete">
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          <span className="text-sm font-semibold">Frete {i + 1}{i === 0 && total > 1 ? " (principal)" : ""}</span>
          {total > 1 && (
            <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-destructive" title="Excluir este frete"
              onClick={() => setForm((f) => setFreights(f, getFreights(f).filter((_, j) => j !== i), ctx.workById))}>
              <Trash2 className="h-3.5 w-3.5" /> Excluir frete
            </Button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
        {byWork ? (
          <div className="space-y-1">
            <Label>Solicitante</Label>
            <SearchSelect value={fr.requester} onChange={(v) => patchFreight(i, { requester: v })} options={requesterOptions} placeholder="Selecione o solicitante" searchPlaceholder="Buscar solicitante" />
          </div>
        ) : (
          <div className="space-y-1">
            <Label>Motorista</Label>
            <SearchSelect value={fr.driver} onChange={(v) => patchFreight(i, { driver: v })} options={driverOptions} placeholder="Selecione o motorista" searchPlaceholder="Buscar motorista" />
          </div>
        )}
        <div className="space-y-1">
          <Label>{byWork ? "Cliente" : "Obra / Cliente"}</Label>
          {/* Caminhão: primeiro o cliente, depois (opcional) o serviço. Só o cliente = rateio pelas horas dos serviços dele. */}
          <Select value={byWork ? base : fr.client} onValueChange={(v) => patchFreight(i, { client: v, place: "" })}>
            <SelectTrigger><SelectValue placeholder={byWork ? "Selecione o cliente" : "Selecione a obra"} /></SelectTrigger>
            <SelectContent>
              {clientOptions()}
              <SelectItem value={MAINTENANCE_KEY}>MANUTENÇÃO</SelectItem>
              <SelectItem value={REVISION_KEY}>REVISÃO</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {byWork && base !== NONE && !SPECIAL_KEYS.has(base) && !ctx.isAdmClient(base) && (
          <div className="space-y-1">
            <Label>Serviço</Label>
            <Select value={fr.client.startsWith(WORK_PREFIX) ? fr.client : ALL_WORKS} onValueChange={(v) => patchFreight(i, { client: v === ALL_WORKS ? base : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_WORKS}>Todos os serviços do cliente (rateio por horas)</SelectItem>
                {ctx.works.filter((w) => w.client_id === base).map((w) => (
                  <SelectItem key={w.id} value={WORK_PREFIX + w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {ctx.isAdmClient(base) && (
          <div className="space-y-1">
            <Label htmlFor={`freight-adm-place-${i}`}>Local</Label>
            <Input id={`freight-adm-place-${i}`} placeholder="Ex.: Banco, Cartório, Fornecedor X" value={fr.place} onChange={(e) => patchFreight(i, { place: e.target.value })} />
          </div>
        )}
        {(fr.client === EXTERNAL_KEY || ctx.isIndustryClient(base)) && (
          <div className="space-y-1">
            <Label>Local</Label>
            {byWork && fr.client !== EXTERNAL_KEY
              ? <IndustryCustomerSelect value={fr.place} onChange={(name) => patchFreight(i, { place: name })} />
              : <Input placeholder="Ex.: Campinas, São Paulo, Bahia" value={fr.place} onChange={(e) => patchFreight(i, { place: e.target.value })} />}
          </div>
        )}
        {i === 0 && ctx.isAdmClient(base) && (
          <div className="space-y-1">
            <Label htmlFor="vehicle-adm-km">Km do dia (ida)</Label>
            <Input id="vehicle-adm-km" inputMode="decimal" placeholder="Ex.: 35" value={form.km}
              onChange={(e) => setForm((f) => ({ ...f, km: e.target.value.replace(/[^\d,.]/g, "") }))} />
          </div>
        )}
        {/* Caminhão/pickup: toggle Motorista embaixo dos seletores; ligado, a lista fica na 2ª coluna. */}
        {byWork && (
          <div className="flex min-h-10 items-center gap-2 sm:col-start-1">
            <Switch id={`freight-driver-${i}`} checked={fr.toggle} onCheckedChange={(v) => patchFreight(i, { toggle: v, driver: v ? fr.driver : NONE })} />
            <Label htmlFor={`freight-driver-${i}`}>Motorista</Label>
            {!fr.toggle && <span className="text-xs text-muted-foreground">(sem marcar, vale o solicitante)</span>}
          </div>
        )}
        {byWork && fr.toggle && (
          <SearchSelect value={fr.driver} onChange={(v) => patchFreight(i, { driver: v })} options={pickDriverOptions} placeholder="Definir" searchPlaceholder="Buscar motorista" />
        )}
        </div>
        {warnings.length > 0 && (
          <ul className="space-y-0.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-foreground">
            {warnings.map((w) => (
              <li key={w} className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />{w}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{freightKmText(fr, i) || "A quilometragem vem da distância cadastrada do cliente."}</p>
        {byWork && i === 0 && base !== NONE && !SPECIAL_KEYS.has(base) && !fr.client.startsWith(WORK_PREFIX) && (
          <p className="text-xs text-muted-foreground">O custo do caminhão no dia é dividido entre os serviços do cliente pelas horas trabalhadas em cada um.</p>
        )}
      </div>
    );
  }

  const noBonus = form.client_id === EXTERNAL_KEY || form.client_id === MAINTENANCE_KEY || form.client_id === REVISION_KEY || (ctx.isIndustryClient(truckClient) && !!form.external_place.trim());

  return (
    <Dialog open={!!cell} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Programação do veículo{cell ? ` · ${ctx.plateOf(cell.vehicleId)} · ${fmtDay(cell.date)}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1">
          {/* Cada frete do dia é uma caixa igual (motorista, cliente, serviço, local, km); o 1º é o principal.
              Dá para excluir qualquer um e arrastar pela alça para mudar a ordem. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Fretes do dia</Label>
              <Button variant="outline" size="sm" onClick={() => setForm((f) => setFreights(f, [...getFreights(f), byWork
                ? { client: NONE, driver: NONE, place: "", requester: f.requester_id, toggle: false }
                : { client: NONE, driver: f.driver_id, place: "", requester: NONE, toggle: false }], ctx.workById))}>
                <Plus className="h-4 w-4" /> Adicionar frete
              </Button>
            </div>
            {freights.map((fr, i, list) => renderFreight(fr, i, list.length))}
            {freights.length > 1 && (
              <p className="text-xs text-muted-foreground">O 1º frete é o principal (viagens); o km dos outros é somado no relatório da frota. O Prêmio Motorista é um por motorista no dia, pela soma do km de ida dos fretes que ele dirige.</p>
            )}
          </div>
          <div className="grid gap-3 rounded-md border border-border p-2.5 sm:grid-cols-3">
            <div className="space-y-1" title="Na 1ª viagem vai a lotação cheia; nas seguintes, uma pessoa a menos (ex.: Suzano, 6 e 5).">
              <Label htmlFor="vehicle-trips">Viagens no dia</Label>
              <Input id="vehicle-trips" type="number" min={1} step="1" value={form.trips} onChange={(e) => setForm((f) => ({ ...f, trips: e.target.value }))} />
            </div>
            <div className="space-y-1" title="Verde = recebe · Cinza = não recebe">
              <Label className="block">Prêmio de Motorista</Label>
              <div className="flex h-10 items-center">
                <Switch checked={form.driver_bonus && !noBonus} disabled={noBonus} onCheckedChange={(v) => setForm((f) => ({ ...f, driver_bonus: v }))} />
              </div>
            </div>
            <div className="space-y-1" title="Aplica a mesma programação nos dias seguintes até a data escolhida.">
              <Label htmlFor="vehicle-repeat">Repetir até (opcional)</Label>
              <Input id="vehicle-repeat" type="date" value={form.repeat_until} onChange={(e) => setForm((f) => ({ ...f, repeat_until: e.target.value }))} />
              <label className="flex items-center gap-2 pt-1 text-xs">
                <Checkbox checked={form.skip_weekend} onCheckedChange={(v) => setForm((f) => ({ ...f, skip_weekend: !!v }))} />
                Pular sábado e domingo
              </label>
            </div>
          </div>
          {targets.length > 0 && (
            <p className={`text-xs ${overwritten.length ? "text-warning" : "text-muted-foreground"}`}>
              Repetir em {targets.length} dia(s).{" "}
              {overwritten.length
                ? `Já têm programação e serão sobrescritos: ${overwritten.map(fmtDay).join(", ")}.`
                : existing.isFetching ? "Conferindo dias já programados…" : "Nenhum desses dias tem programação deste veículo."}
            </p>
          )}
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" onClick={props.onRemove} disabled={!props.hasRow}>
            <Trash2 className="h-4 w-4 text-destructive" /> Remover
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={props.onClose}>Cancelar</Button>
            <Button onClick={() => props.onSave(form, targets)} disabled={props.saving || (targets.length > 0 && existing.isFetching)}>
              {overwritten.length ? `Salvar e sobrescrever ${overwritten.length} dia(s)` : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

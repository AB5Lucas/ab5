/**
 * Logística (Veículos › Logística): cálculo da carga, veículo sugerido, alertas e mensagem D-1 ao motorista.
 * Regras puras; a tela (routes/_authenticated/logistica.tsx) só lê e grava.
 */
export type LogVehicle = {
  id: string; plate: string; model: string | null; type: string | null; status?: string | null;
  cargo_capacity_kg: number | null; bed_length_m: number | null; cargo_volume_m3: number | null; cnh_category: string | null; has_crane?: boolean | null;
};
export type LogItem = { description: string; qty: number; unit_weight_kg: number; length_m: number | null; unit_volume_m3: number | null };
export type LogAddress = { id: string; name: string; street: string | null; city: string; uf: string; receive_from: string | null; receive_to: string | null; needs_booking: boolean; notes: string | null };
export type LogRestriction = { city: string; weekday: number; plate_endings: string; windows: string };
export type LogDemand = {
  id: string; kind: string; title: string; status: string; due_date: string | null; scheduled_date: string | null; departure_time: string | null;
  vehicle_id: string | null; driver_id: string | null; trips: number; origin_id: string | null; dest_id: string | null; contact: string | null;
  notes: string | null; message_sent_at: string | null;
  /** Fim previsto no dia (agenda); sem fim = 1 hora. */
  end_time?: string | null | undefined;
  /** Quem transporta: veículo nosso (ab5) ou só o cliente/terceiro que vem no horário. */
  carrier?: string | null | undefined; carrier_name?: string | null | undefined; carrier_plate?: string | null | undefined;
  carrier_driver?: string | null | undefined; carrier_phone?: string | null | undefined;
};
export type LogDriver = { id: string; full_name: string; driver_license_category: string | null; driver_license_expiry: string | null };
export type LogAlert = { tone: "red" | "orange"; text: string };

export const KIND_LABEL: Record<string, string> = {
  entregar: "Entregar em obra", buscar: "Buscar material", retirar: "Retirar de obra", transferir: "Transferência",
  receber: "Receber (cliente/fornecedor traz)", expedir: "Expedir (cliente retira)",
};
export const CARRIER_LABEL: Record<string, string> = { ab5: "Veículo AB5", cliente: "Cliente", terceiro: "Terceiro / fornecedor" };
export const isOwn = (d: Pick<LogDemand, "carrier">) => (d.carrier ?? "ab5") === "ab5";
const num = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (n: number, d = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const kg = (n: number) => (n >= 1000 ? `${fmt(n / 1000, 1)} t` : `${fmt(n, 0)} kg`);
const plain = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const minutes = (t: string | null | undefined) => { const m = /^(\d{1,2}):(\d{2})/.exec(t ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Início e fim do evento em minutos do dia (sem fim = 1 hora; sem início = null). */
export function timeSpan(d: Pick<LogDemand, "departure_time" | "end_time">) {
  const a = minutes(d.departure_time);
  if (a == null) return null;
  const b = minutes(d.end_time);
  return { start: a, end: b != null && b > a ? b : a + 60 };
}
/** Quantas outras demandas do mesmo dia batem no horário: do mesmo veículo (nosso) e no mesmo local (carga ou descarga). */
export function overlapCounts(list: LogDemand[]) {
  const out = new Map<string, { vehicle: number; place: number }>();
  const live = list.filter((d) => d.scheduled_date && d.status !== "cancelada" && d.status !== "concluida");
  for (const d of live) {
    const a = timeSpan(d);
    let vehicle = 0, place = 0;
    if (a) for (const o of live) {
      if (o.id === d.id || o.scheduled_date !== d.scheduled_date) continue;
      const b = timeSpan(o);
      if (!b || b.start >= a.end || a.start >= b.end) continue;
      if (isOwn(d) && isOwn(o) && d.vehicle_id && d.vehicle_id === o.vehicle_id) vehicle++;
      const pd = [d.origin_id, d.dest_id].filter(Boolean), po = [o.origin_id, o.dest_id].filter(Boolean);
      if (pd.some((x) => po.includes(x))) place++;
    }
    out.set(d.id, { vehicle, place });
  }
  return out;
}

/** Peso total, volume total e maior peça da carga. */
export function loadSummary(items: LogItem[]) {
  let weight = 0, volume = 0, maxLength = 0;
  for (const i of items) {
    weight += num(i.qty) * num(i.unit_weight_kg);
    volume += num(i.qty) * num(i.unit_volume_m3);
    maxLength = Math.max(maxLength, num(i.length_m));
  }
  return { weight, volume, maxLength };
}

export type VehicleFit = { vehicle: LogVehicle; fits: boolean; trips: number; reason: string };
/** Veículos que atendem a carga (comprimento cabe, peso e volume divididos em viagens), do mais adequado ao menos. */
export function suggestVehicles(load: ReturnType<typeof loadSummary>, vehicles: LogVehicle[]): VehicleFit[] {
  return vehicles.filter((v) => num(v.cargo_capacity_kg) > 0).map((v) => {
    const cap = num(v.cargo_capacity_kg), bed = num(v.bed_length_m), vol = num(v.cargo_volume_m3);
    const lengthOk = !bed || load.maxLength <= bed;
    const trips = Math.max(1, Math.ceil(load.weight / cap), vol && load.volume ? Math.ceil(load.volume / vol) : 1);
    const reason = !lengthOk ? `Peça de ${fmt(load.maxLength)} m passa da carroceria (${fmt(bed)} m).`
      : `${trips} viagem(ns) · ${Math.round((load.weight / trips / cap) * 100)}% do peso por viagem`;
    return { vehicle: v, fits: lengthOk, trips, reason };
  }).sort((a, b) => Number(b.fits) - Number(a.fits) || a.trips - b.trips || num(a.vehicle.cargo_capacity_kg) - num(b.vehicle.cargo_capacity_kg));
}

/** Final da placa (último dígito). */
export const plateEnding = (plate: string) => { const d = plate.replace(/[^0-9]/g, ""); return d ? d[d.length - 1]! : ""; };

/** Rodízio: a placa não roda nessa cidade nesse dia (devolve as faixas de horário). */
export function rodizio(plate: string, date: string, cities: (string | null | undefined)[], rules: LogRestriction[]) {
  const end = plateEnding(plate);
  const wd = weekday(date);
  const keys = new Set(cities.map(plain).filter(Boolean));
  return rules.find((r) => r.weekday === wd && keys.has(plain(r.city)) && r.plate_endings.split(",").map((x) => x.trim()).includes(end)) ?? null;
}
const inWindows = (t: string | null, windows: string) => {
  const m = minutes(t);
  if (m == null) return false;
  return windows.split(",").some((w) => { const [a, b] = w.split("-"); const x = minutes(a), y = minutes(b); return x != null && y != null && m >= x && m < y; });
};
const windowsLabel = (w: string) => w.split(",").map((x) => x.replace(/:00/g, "h").replace("-", " às ")).join(" e ");

const CNH_ORDER = ["B", "C", "D", "E"];
/** A CNH do motorista cobre a categoria exigida pelo veículo? (A é moto e não conta; E cobre D, que cobre C...) */
export function cnhCovers(driverCat: string | null | undefined, vehicleCat: string | null | undefined) {
  if (!vehicleCat) return true;
  const need = CNH_ORDER.indexOf(vehicleCat.toUpperCase().replace(/[^B-E]/g, "").slice(-1));
  if (need < 0) return true;
  const has = Math.max(-1, ...(driverCat ?? "").toUpperCase().split("").map((c) => CNH_ORDER.indexOf(c)));
  return has >= need;
}

export type AlertCtx = {
  today: string; now: Date; items: LogItem[]; vehicle?: LogVehicle | null | undefined; driver?: LogDriver | null | undefined;
  origin?: LogAddress | null | undefined; dest?: LogAddress | null | undefined; rules: LogRestriction[];
  /** Veículo já escalado na Transporte no mesmo dia. */
  transportBusy?: boolean | undefined;
  /** Outras demandas do mesmo veículo no mesmo horário. */
  overlapVehicle?: number | undefined;
  /** Outras demandas no mesmo local no mesmo horário. */
  overlapPlace?: number | undefined;
};

/** Alertas da demanda: vermelho = resolver antes de sair; laranja = atenção. */
export function demandAlerts(d: LogDemand, c: AlertCtx): LogAlert[] {
  const out: LogAlert[] = [];
  if (d.status === "cancelada" || d.status === "concluida") return out;
  const load = loadSummary(c.items);
  const own = isOwn(d);
  const v = own ? c.vehicle : null;
  if (d.status === "pendente" && d.due_date && !d.scheduled_date && d.due_date <= addDays(c.today, 2)) {
    out.push({ tone: d.due_date < c.today ? "red" : "orange", text: d.due_date < c.today ? "Prazo vencido sem programação" : "Prazo em até 2 dias sem programação" });
  }
  if (v) {
    const cap = num(v.cargo_capacity_kg), bed = num(v.bed_length_m);
    const perTrip = load.weight / Math.max(1, d.trips);
    if (cap && perTrip > cap) out.push({ tone: "red", text: `Peso por viagem ${kg(perTrip)} acima da capacidade (${kg(cap)}): aumente as viagens ou troque o veículo` });
    else if (cap && perTrip >= cap * 0.9) out.push({ tone: "orange", text: `Peso por viagem ${kg(perTrip)} = ${Math.round((perTrip / cap) * 100)}% da capacidade` });
    if (bed && load.maxLength > bed) out.push({ tone: "red", text: `Peça de ${fmt(load.maxLength)} m passa da carroceria (${fmt(bed)} m)` });
    if (v.status && !["active", "available"].includes(v.status)) out.push({ tone: "red", text: "Veículo fora de operação (manutenção ou inativo)" });
    if (d.scheduled_date) {
      const r = rodizio(v.plate, d.scheduled_date, [c.origin?.city, c.dest?.city], c.rules);
      if (r) out.push({ tone: inWindows(d.departure_time, r.windows) ? "red" : "orange", text: `Rodízio em ${r.city}: placa final ${plateEnding(v.plate)} não roda das ${windowsLabel(r.windows)}` });
      if (c.transportBusy) out.push({ tone: "orange", text: "Conflito: veículo também escalado na Transporte neste dia" });
      if (c.overlapVehicle) out.push({ tone: "red", text: `Horário batendo com mais ${c.overlapVehicle} demanda(s) do mesmo veículo` });
    }
  }
  if (!own && d.carrier_plate && d.scheduled_date) {
    const r = rodizio(d.carrier_plate, d.scheduled_date, [c.origin?.city, c.dest?.city], c.rules);
    if (r) out.push({ tone: inWindows(d.departure_time, r.windows) ? "red" : "orange", text: `Rodízio em ${r.city}: placa final ${plateEnding(d.carrier_plate)} não roda das ${windowsLabel(r.windows)}` });
  }
  if (c.overlapPlace) out.push({ tone: "orange", text: `Mais ${c.overlapPlace} carga/descarga no mesmo local e horário` });
  if (d.end_time && d.departure_time && minutes(d.end_time)! <= minutes(d.departure_time)!) out.push({ tone: "orange", text: "Fim antes do início" });
  if (c.driver && v && own) {
    if (!cnhCovers(c.driver.driver_license_category, v.cnh_category)) out.push({ tone: "red", text: `CNH ${c.driver.driver_license_category ?? "não cadastrada"} não cobre a categoria ${v.cnh_category} do veículo` });
    if (c.driver.driver_license_expiry && d.scheduled_date && c.driver.driver_license_expiry < d.scheduled_date) out.push({ tone: "red", text: "CNH do motorista vencida na data" });
  }
  for (const [label, a] of [["carga", c.origin], ["descarga", c.dest]] as const) {
    if (!a) continue;
    if (a.needs_booking) out.push({ tone: "orange", text: `Local de ${label} (${a.name}) exige agendamento` });
    const dep = minutes(d.departure_time), to = minutes(a.receive_to);
    if (label === "descarga" && dep != null && to != null && dep >= to) out.push({ tone: "orange", text: `Saída ${d.departure_time?.slice(0, 5)} depois da janela de recebimento (até ${a.receive_to?.slice(0, 5)})` });
  }
  if (d.scheduled_date === addDays(c.today, 1) && !d.message_sent_at && (own || d.carrier_phone)) {
    const br = new Date(c.now.getTime() - 3 * 3600_000);
    if (br.getUTCHours() >= 16) out.push({ tone: "orange", text: "Mensagem para o motorista ainda não enviada" });
  }
  if (own && d.status === "programada" && (!d.vehicle_id || !d.scheduled_date)) out.push({ tone: "orange", text: "Programada sem veículo ou data" });
  return out;
}

const WEEK = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** Texto da véspera para o motorista (WhatsApp). */
export function driverMessage(d: LogDemand, c: { items: LogItem[]; vehicle?: LogVehicle | null | undefined; driver?: LogDriver | null | undefined; origin?: LogAddress | null | undefined; dest?: LogAddress | null | undefined; rules: LogRestriction[] }) {
  const date = d.scheduled_date ?? "";
  const load = loadSummary(c.items);
  const addr = (a?: LogAddress | null) => (a ? `${a.name}${a.street ? `, ${a.street}` : ""} — ${a.city}/${a.uf}` : "—");
  const lines = [
    `*Logística — ${WEEK[weekday(date)] ?? ""} ${date.split("-").reverse().join("/")}*`,
    isOwn(d) && c.driver ? `Motorista: ${c.driver.full_name}` : "",
    isOwn(d) && c.vehicle ? `Veículo: ${[c.vehicle.model, c.vehicle.plate].filter(Boolean).join(" · ")}` : "",
    !isOwn(d) && (d.carrier_name || d.carrier_driver) ? `${[d.carrier_name, d.carrier_driver].filter(Boolean).join(" · ")}${d.carrier_plate ? ` · placa ${d.carrier_plate}` : ""}` : "",
    d.departure_time ? `Horário: ${d.departure_time.slice(0, 5)}${d.end_time ? ` às ${d.end_time.slice(0, 5)}` : ""}` : "",
    "",
    `*${d.title}* (${KIND_LABEL[d.kind] ?? d.kind})`,
    `Carregar em: ${addr(c.origin)}`,
    `Descarregar em: ${addr(c.dest)}`,
    c.dest?.receive_from || c.dest?.receive_to ? `Recebimento: ${c.dest?.receive_from?.slice(0, 5) ?? "?"} às ${c.dest?.receive_to?.slice(0, 5) ?? "?"}` : "",
    d.trips > 1 ? `Viagens: ${d.trips}` : "",
    "",
    "Carga:",
    ...c.items.map((i) => `• ${fmt(num(i.qty), 0)} ${i.description}`),
    `Total ≈ ${kg(load.weight)}${load.maxLength ? ` · maior peça ${fmt(load.maxLength)} m` : ""}`,
    d.contact ? `\nContato no local: ${d.contact}` : "",
    d.notes ? `Obs.: ${d.notes}` : "",
  ];
  const plate = isOwn(d) ? c.vehicle?.plate : d.carrier_plate;
  const r = plate && date ? rodizio(plate, date, [c.origin?.city, c.dest?.city], c.rules) : null;
  if (r) lines.push(`\n⚠ Rodízio em ${r.city}: não rodar das ${windowsLabel(r.windows)}.`);
  return lines.filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
}

/** Constantes, tipos e funções puras da aba Transporte (vehicle-timeline*). */
export const EXTERNAL_KEY = "__external__";
export const MAINTENANCE_KEY = "__maintenance__";
/** Revisão do veículo: igual à Manutenção (0 km, sem prêmios), só muda o nome (maintenance_kind = revisao). */
export const REVISION_KEY = "__revision__";
export const SUZANO_LOCAL_KEY = "__suzano_local__";
export const KM_SUZANO_LOCAL = 6;
export const KM_WORK = 50;
export const KM_EXTERNAL = 100;
/** A logística por clientes Indústria (km de ida e pedágio do cadastro) vale a partir desta data. */
export const LOGISTICS_START = "2026-10-26";

export const NONE = "__none__";
export const WORK_PREFIX = "w:";
export const ALL_WORKS = "__all_works__";
export const SPECIAL_KEYS = new Set([EXTERNAL_KEY, MAINTENANCE_KEY, REVISION_KEY, SUZANO_LOCAL_KEY]);

export type VehicleScheduleRow = {
  id: string;
  schedule_date: string;
  vehicle_id: string;
  driver_id: string | null;
  client_id: string | null;
  is_external: boolean;
  is_maintenance: boolean;
  maintenance_kind?: string | null;
  driver_bonus: boolean;
  km: number;
  extra_client_ids?: string[];
  extra_driver_ids?: string[];
  /** Caminhão/pickup: quem pediu o frete (Solicitante) e se o Motorista foi marcado; driver_id = motorista que vale (o marcado, senão o solicitante). */
  requester_id?: string | null;
  driver_toggle?: boolean;
  extra_requester_ids?: string[];
  extra_driver_toggles?: boolean[];
  /** Local digitado por obra adicional (Indústria = viagem fora); mesma posição de extra_client_ids. */
  extra_places?: string[];
  /** Serviço de cada obra adicional (caminhão/pickup); vazio = rateio do cliente. Mesma posição de extra_client_ids. */
  extra_work_ids?: string[];
  extra_km?: number;
  trips?: number;
  is_suzano_local?: boolean;
  work_id?: string | null;
  external_place?: string | null;
  /** Cliente ADM: local digitado no lugar do serviço (só nome, não muda km nem prêmio). */
  adm_place?: string | null;
  place_toll?: number | null;
};

export type CellForm = {
  driver_id: string;
  client_id: string;
  driver_bonus: boolean;
  repeat_until: string;
  /** Repetir até: pula sábado e domingo (padrão ligado). */
  skip_weekend: boolean;
  extras: string[];
  extraDrivers: string[];
  extraPlaces: string[];
  extraWorks: string[];
  trips: string;
  external_place: string;
  /** Km de ida digitado (só cliente ADM). */
  km: string;
  /** Caminhão/pickup: Solicitante e toggle Motorista (driver_id = motorista marcado; NONE = Definir). */
  requester_id: string;
  driver_toggle: boolean;
  extraRequesters: string[];
  extraToggles: boolean[];
};

export const EMPTY_FORM: CellForm = { driver_id: NONE, client_id: NONE, driver_bonus: false, repeat_until: "", skip_weekend: true, extras: [], extraDrivers: [], extraPlaces: [], extraWorks: [], trips: "1", external_place: "", km: "", requester_id: NONE, driver_toggle: false, extraRequesters: [], extraToggles: [] };

/** Frete do dia no editor: o principal (form.client_id/driver_id/external_place) + obras adicionais, como uma lista. */
export type Freight = { client: string; driver: string; place: string; requester: string; toggle: boolean };
type WorkLite = { id: string; name: string; client_id: string | null };

export function getFreights(f: CellForm): Freight[] {
  const main: Freight = { client: f.client_id, driver: f.driver_id, place: f.external_place, requester: f.requester_id, toggle: f.driver_toggle };
  const extras = f.extras.map((c, i) => ({ client: f.extraWorks[i] ? WORK_PREFIX + f.extraWorks[i] : c, driver: f.extraDrivers[i] ?? NONE, place: f.extraPlaces[i] ?? "",
    requester: f.extraRequesters[i] ?? NONE, toggle: !!f.extraToggles[i] }));
  return [main, ...extras];
}

export function setFreights(f: CellForm, list: Freight[], workById: Map<string, WorkLite>): CellForm {
  const [main, ...rest] = list.length ? list : [{ client: NONE, driver: NONE, place: "", requester: NONE, toggle: false }];
  const baseOf = (c: string) => (c.startsWith(WORK_PREFIX) ? workById.get(c.slice(WORK_PREFIX.length))?.client_id ?? NONE : c);
  return {
    ...f,
    client_id: main!.client, driver_id: main!.driver, external_place: main!.place, requester_id: main!.requester, driver_toggle: main!.toggle,
    extraRequesters: rest.map((x) => x.requester),
    extraToggles: rest.map((x) => x.toggle),
    // O km digitado (ADM) é do frete principal: some se outro frete passar a ser o principal.
    km: main!.client === f.client_id ? f.km : "",
    extras: rest.map((x) => baseOf(x.client)),
    extraWorks: rest.map((x) => (x.client.startsWith(WORK_PREFIX) ? x.client.slice(WORK_PREFIX.length) : "")),
    extraDrivers: rest.map((x) => x.driver),
    extraPlaces: rest.map((x) => x.place),
  };
}

/** Motorista que vale no frete: caminhão/pickup = o marcado no toggle, senão o solicitante se for motorista; demais = o escolhido. */
export function freightDriver(fr: Freight, byWork: boolean, isDriver: (id: string) => boolean): string | null {
  if (!byWork) return fr.driver !== NONE ? fr.driver : null;
  if (fr.toggle && fr.driver !== NONE) return fr.driver;
  return fr.requester !== NONE && isDriver(fr.requester) ? fr.requester : null;
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isWeekend(iso: string) {
  const d = new Date(`${iso}T00:00:00`).getDay();
  return d === 0 || d === 6;
}

/** Dias de destino de "Repetir até" / "Copiar dia" (inclusive), opcionalmente sem sábado e domingo. */
export function dateRange(from: string, to: string, skipWeekend: boolean): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!skipWeekend || !isWeekend(d)) out.push(d);
  return out;
}

export const shortName = (full: string) => full.trim().split(/\s+/).slice(0, 2).join(" ");
export const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Motoristas da linha (principal e fretes extras), sem repetir. */
export const rowDrivers = (r: Pick<VehicleScheduleRow, "driver_id" | "extra_driver_ids">) =>
  [...new Set([r.driver_id, ...(r.extra_driver_ids ?? [])].filter((d): d is string => !!d))];

/** Motorista → placas/veículos em que ele está escalado no dia (para avisar repetição). */
export function driversByDay(rows: VehicleScheduleRow[]): Map<string, Map<string, Set<string>>> {
  const out = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    // Manutenção/Revisão: o nome no campo é só o responsável (ex.: Emerson), não conta como repetição.
    if (r.is_maintenance) continue;
    const day = out.get(r.schedule_date) ?? new Map<string, Set<string>>();
    out.set(r.schedule_date, day);
    for (const d of rowDrivers(r)) {
      const s = day.get(d) ?? new Set<string>();
      s.add(r.vehicle_id);
      day.set(d, s);
    }
  }
  return out;
}

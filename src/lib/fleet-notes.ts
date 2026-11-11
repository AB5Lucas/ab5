import { normalizePlate } from "./fleet-costs";

/** Frota › Notas: abastecimentos lidos dos XML do posto, conferência com as notas, rateio e centro de custo. */

export type FuelNoteRow = {
  access_key: string; xml_file: string; issued_at: string | null; nf_number: string | null; issuer: string | null;
  plate: string | null; km: number | null; driver: string | null; fuel: string | null;
  quantity: number | null; unit_price: number | null; total: number | null; info: string | null;
};

const MONTHS = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  const n = MONTHS[(m ?? 1) - 1] ?? "";
  return `${n.charAt(0)}${n.slice(1).toLowerCase().replace("marco", "março")}/${y}`;
};
const plain = (v: string) => v.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Caminho no SharePoint a partir do que a pessoa colar: aceita o caminho da pasta sincronizada no
 * computador ("...\servidor dados - Compras\06 FISCAL\...") ou já no formato "Compras/06 FISCAL/...".
 */
export function sharepointPath(input: string): string {
  let p = input.trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
  const m = p.match(/servidor dados - ([^/]+)\/(.*)$/i);
  if (m) p = `${m[1]}/${m[2]}`;
  return p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

/** O nome da pasta é do mês? Aceita "11", "11.2026", "2026-11", "NOVEMBRO", "11 - NOV 2026"... (ano, se houver, tem de bater). */
export function folderMonthScore(name: string, ym: string): number {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const n = plain(name);
  // Só números, juntos ou separados: "112026", "11.2026", "202611".
  const digits = n.replace(/\D/g, "");
  const mm = String(m).padStart(2, "0");
  if (/^[\d\s._/-]+$/.test(n)) {
    if ([`${mm}${y}`, `${y}${mm}`, `${m}${y}`].includes(digits)) return 5;
    return digits.length <= 2 && Number(digits) === m ? 1 : 0;
  }
  const years = n.match(/(?:^|\D)(20\d{2})(?!\d)/g)?.map((s) => Number(s.replace(/\D/g, ""))) ?? [];
  if (years.length && !years.includes(y)) return 0;
  const rest = n.replace(/20\d{2}/g, " ");
  const byName = new RegExp(`(^|[^A-Z])(${MONTHS[m - 1]}|${MONTHS[m - 1]!.slice(0, 3)})([^A-Z]|$)`).test(rest);
  const byNumber = new RegExp(`(^|\\D)0?${m}(\\D|$)`).test(rest);
  if (!byName && !byNumber) return 0;
  return (years.length ? 2 : 1) + (byName ? 1 : 0) + (byNumber ? 1 : 0);
}
/** Nome de pasta que já é de um mês ("112026", "11.2026", "2026-11"): a pasta configurada é a de cima. */
export const isMonthFolderName = (name: string) => /^(\d{6}|\d{1,2}[._ -]\d{4}|\d{4}[._ -]\d{1,2})$/.test(name.trim());
/** Pasta-mãe onde ficam as pastas de cada mês (se colarem o caminho de um mês, sobe um nível). */
export function baseFolderPath(input: string): string {
  const p = sharepointPath(input);
  const parts = p.split("/");
  return parts.length > 1 && isMonthFolderName(parts[parts.length - 1]!) ? parts.slice(0, -1).join("/") : p;
}

/** Data e hora da foto pelo nome ("WhatsApp Image 2026-11-04 at 15.16.43", "IMG_20261104_151643"), no horário de Brasília. */
export function photoTime(name: string): number | null {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2}) at (\d{2})\.(\d{2})\.(\d{2})/) ?? name.match(/(20\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-03:00`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Liga cada abastecimento à foto da nota pela hora: a foto mais próxima, tirada de 30 min antes até 24 h
 * depois da emissão; cada foto vale para um abastecimento só (os pares mais próximos primeiro).
 */
export function matchPhotosByTime(notes: { key: string; issued_at: string | null }[], docs: string[]): Map<string, string> {
  const pairs: { key: string; doc: string; gap: number }[] = [];
  for (const n of notes) {
    const t = n.issued_at ? Date.parse(n.issued_at) : NaN;
    if (Number.isNaN(t)) continue;
    for (const d of docs) {
      const p = photoTime(d);
      if (p == null) continue;
      const gap = p - t;
      if (gap >= -30 * 60_000 && gap <= 24 * 3600_000) pairs.push({ key: n.key, doc: d, gap: gap < 0 ? -gap * 2 : gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap);
  const out = new Map<string, string>(), used = new Set<string>();
  for (const p of pairs) if (!out.has(p.key) && !used.has(p.doc)) { out.set(p.key, p.doc); used.add(p.doc); }
  return out;
}

/** Outras placas escritas no texto da nota (ex.: placa certa digitada no campo do motorista). */
export function otherPlates(info: string | null, plate: string | null): string[] {
  if (!info) return [];
  const t = plain(info);
  const found = [...t.matchAll(new RegExp(PLATE.source, "g"))].map((m) => normalizePlate(`${m[1]}${m[2]}`));
  return [...new Set(found)].filter((p) => p !== plate);
}

export function pickMonthFolder<T extends { name: string }>(folders: T[], ym: string): T | null {
  return folders.map((f) => ({ f, s: folderMonthScore(f.name, ym) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name))[0]?.f ?? null;
}

// ---------- XML da NF-e / NFC-e ----------
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&").trim();
const tagRe = (name: string, flags = "") => new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, flags);
const tag = (xml: string, name: string) => { const m = xml.match(tagRe(name)); return m ? decode(m[1]!) : null; };
const tags = (xml: string, name: string) => [...xml.matchAll(tagRe(name, "g"))].map((m) => m[1]!);
const num = (v: string | null) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Número escrito como no Brasil ("84.320", "84320,5") ou como no XML ("84320.5"). */
export function kmNumber(v: string): number | null {
  let s = v.trim();
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const PLATE = /\b([A-Z]{3})[\s-]?(\d[A-Z0-9]\d{2})\b/;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\s+(D[aeo]s?|E)\s+/g, (m) => m.toLowerCase());

/** Placa, km e condutor do texto livre da nota (infCpl e campos de observação). */
export function infoFields(text: string): { plate: string | null; km: number | null; driver: string | null } {
  const t = plain(text).replace(/\s+/g, " ");
  const plateTxt = t.match(/PLACA\W{0,3}([A-Z]{3}[\s-]?\d[A-Z0-9]\d{2})/)?.[1] ?? t.match(PLACA_FALLBACK)?.[0] ?? null;
  const kmTxt = t.match(/(?:\bKM|HODOMETRO|ODOMETRO|QUILOMETRAGEM|KILOMETRAGEM)\b\W{0,3}(\d[\d.,]*)/)?.[1] ?? null;
  const drv = t.match(/(?:MOTORISTA|CONDUTOR|FRENTISTA_CLIENTE|RESPONSAVEL)\W{0,3}([A-Z][A-Z .']{2,60}?)(?=\s*(?:[-|;,/:.]|\bPLACA\b|\bKM\b|\bHOD|\bVEIC|\bCPF\b|\bRG\b|\d|$))/)?.[1]?.trim() ?? null;
  return { plate: plateTxt ? normalizePlate(plateTxt) : null, km: kmTxt ? kmNumber(kmTxt) : null, driver: drv && drv.length > 2 ? titleCase(drv) : null };
}
const PLACA_FALLBACK = new RegExp(PLATE.source);

const FUEL = /DIESEL|GASOLINA|ETANOL|ALCOOL|GNV|ARLA|S-?10|S-?500/i;
/** Lê um XML do posto. Devolve null se não for uma NF-e/NFC-e. */
export function parseFuelXml(xml: string, fileName: string): FuelNoteRow | null {
  if (!/<(?:\w+:)?infNFe\b/.test(xml)) return null;
  const key = xml.match(/Id="NFe(\d{44})"/)?.[1] ?? tag(xml, "chNFe") ?? fileName.replace(/\D/g, "").match(/\d{44}/)?.[0] ?? null;
  if (!key) return null;
  const items = tags(xml, "det").map((d) => ({
    name: tag(d, "xProd") ?? "", unit: (tag(d, "uCom") ?? "").toUpperCase(), qty: num(tag(d, "qCom")),
    price: num(tag(d, "vUnCom")), value: num(tag(d, "vProd")), comb: /<(?:\w+:)?comb\b/.test(d),
  }));
  const fuels = items.filter((i) => i.comb).length ? items.filter((i) => i.comb) : items.filter((i) => FUEL.test(i.name)).length ? items.filter((i) => FUEL.test(i.name)) : items;
  const qty = fuels.reduce((s, i) => s + (i.qty ?? 0), 0);
  const value = fuels.reduce((s, i) => s + (i.value ?? 0), 0);
  const obs = [...xml.matchAll(/<(?:\w+:)?obsCont[^>]*xCampo="([^"]*)"[^>]*>([\s\S]*?)<\/(?:\w+:)?obsCont>/g)]
    .map((m) => `${decode(m[1]!)}: ${tag(m[2]!, "xTexto") ?? ""}`);
  const info = [tag(xml, "infCpl"), ...obs].filter(Boolean).join(" | ");
  const fields = infoFields(info);
  const nf = (tag(xml, "nNF") ?? "").replace(/\D/g, "") || null;
  return {
    access_key: key, xml_file: fileName, issued_at: tag(xml, "dhEmi") ?? (tag(xml, "dEmi") ? `${tag(xml, "dEmi")}T12:00:00-03:00` : null),
    nf_number: nf, issuer: tag(tags(xml, "emit")[0] ?? "", "xFant") ?? tag(tags(xml, "emit")[0] ?? "", "xNome"),
    plate: fields.plate, km: fields.km, driver: fields.driver,
    fuel: [...new Set(fuels.map((i) => i.name).filter(Boolean))].join(" + ") || null,
    quantity: qty ? Math.round(qty * 1000) / 1000 : null,
    unit_price: qty ? Math.round((value / qty) * 10000) / 10000 : fuels[0]?.price ?? null,
    total: num(tag(xml, "vNF")) ?? (value || null), info: info || null,
  };
}

// ---------- Rateio, centro de custo e item conta ----------
export type RateioSchedule = { vehicle_id: string; schedule_date: string; client_id: string | null; extra_client_ids?: string[] | null; is_maintenance?: boolean | null };
export type RateioClient = { id: string; name: string; cc_prefix: string | null };
export type RateioWork = { id: string; client_id: string | null; cc_suffix: string | null; active: boolean };
export type ItemAccount = { cc_code: string; item_account: string };
export type RateioPart = { client_id: string; client: string; days: number; pct: number; value: number; cc: string | null; cc_rule: string; item_account: string | null };
export type Rateio = { from: string; to: string; fallback: boolean; parts: RateioPart[] };

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const isoDay = (ts: string | null) => {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts.slice(0, 10) : new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
};

/** CC do cliente: com um único serviço ativo, o CC dele; com mais de um, o almoxarifado (final 999). */
export function clientCc(client: RateioClient | undefined, works: RateioWork[]): { cc: string | null; rule: string } {
  const prefix = (client?.cc_prefix ?? "").trim();
  if (!prefix) return { cc: null, rule: "cliente sem prefixo de CC" };
  const own = works.filter((w) => w.client_id === client!.id && w.active);
  if (own.length === 1) {
    const suffix = (own[0]!.cc_suffix ?? "").trim();
    return suffix ? { cc: `${prefix}${suffix}`, rule: "único serviço" } : { cc: null, rule: "serviço sem sufixo de CC" };
  }
  return { cc: `${prefix}999`, rule: own.length ? `${own.length} serviços: almoxarifado` : "sem serviço ativo: almoxarifado" };
}
/** Item conta pela equivalência: o CC exato; senão o prefixo do cliente (4 primeiros dígitos). */
export function itemAccountFor(cc: string | null, accounts: ItemAccount[]): string | null {
  if (!cc) return null;
  return accounts.find((a) => a.cc_code.trim() === cc)?.item_account ?? accounts.find((a) => a.cc_code.trim() === cc.slice(0, 4))?.item_account ?? null;
}

/**
 * Rateio de um abastecimento: dias em que o veículo esteve em cada cliente (Transporte) desde o
 * abastecimento anterior até este. Sem programação no período, usa o último dia programado antes dele.
 */
export function fuelRateio(opts: {
  vehicleId: string | null; day: string; prevDay: string | null; total: number;
  schedules: RateioSchedule[]; clients: Map<string, RateioClient>; works: RateioWork[]; accounts: ItemAccount[];
}): Rateio {
  const from = opts.prevDay && opts.prevDay < opts.day ? addDays(opts.prevDay, 1) : addDays(opts.day, -29);
  const own = opts.vehicleId ? opts.schedules.filter((s) => s.vehicle_id === opts.vehicleId && !s.is_maintenance) : [];
  const clientsOf = (s: RateioSchedule) => [...new Set([s.client_id, ...(s.extra_client_ids ?? [])].filter((c): c is string => !!c))];
  let days = own.filter((s) => s.schedule_date >= from && s.schedule_date <= opts.day && clientsOf(s).length);
  let fallback = false;
  if (!days.length) {
    const last = own.filter((s) => s.schedule_date <= opts.day && s.schedule_date >= addDays(opts.day, -60) && clientsOf(s).length)
      .sort((a, b) => b.schedule_date.localeCompare(a.schedule_date))[0];
    if (last) { days = own.filter((s) => s.schedule_date === last.schedule_date && clientsOf(s).length); fallback = true; }
  }
  const weight = new Map<string, number>();
  const byDate = new Map<string, RateioSchedule[]>();
  for (const s of days) byDate.set(s.schedule_date, [...(byDate.get(s.schedule_date) ?? []), s]);
  for (const list of byDate.values()) {
    const cs = [...new Set(list.flatMap(clientsOf))];
    for (const c of cs) weight.set(c, (weight.get(c) ?? 0) + 1 / cs.length);
  }
  const sum = [...weight.values()].reduce((s, v) => s + v, 0);
  const totalCents = Math.round(opts.total * 100);
  let given = 0;
  const parts = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([id, w], i, all) => {
    const cents = i === all.length - 1 ? totalCents - given : Math.round((totalCents * w) / sum);
    given += cents;
    const client = opts.clients.get(id);
    const { cc, rule } = clientCc(client, opts.works);
    return { client_id: id, client: client?.name ?? "Cliente", days: Math.round(w * 100) / 100, pct: Math.round((w / sum) * 10000) / 100, value: cents / 100, cc, cc_rule: rule, item_account: itemAccountFor(cc, opts.accounts) };
  });
  return { from, to: opts.day, fallback, parts };
}

/** Situação de uma linha para os filtros. */
export type NoteStatus = "sem-nota" | "pendente" | "aprovada";
export const noteStatus = (n: { note_file: string | null; approved_at: string | null }): NoteStatus =>
  n.approved_at ? "aprovada" : !n.note_file ? "sem-nota" : "pendente";

// ---------- Manutenção ----------
export type MaintenancePlan = { interval_km: number | null; interval_months: number | null; base_km: number | null; base_date: string | null };
export type MaintenanceState = { lastKm: number | null; lastDate: string | null; nextKm: number | null; nextDate: string | null; kmLeft: number | null; daysLeft: number | null; status: "sem-regra" | "em-dia" | "perto" | "vencida" };
const addMonthsDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

/** Próxima revisão pela regra do veículo (km e/ou meses desde a última preventiva); "perto" = 10% do km ou 30 dias. */
export function maintenanceState(plan: MaintenancePlan | null, last: { km: number | null; date: string | null } | null, currentKm: number | null, today: string): MaintenanceState {
  const lastKm = last?.km ?? plan?.base_km ?? null;
  const lastDate = last?.date ?? plan?.base_date ?? null;
  const ik = plan?.interval_km || null, im = plan?.interval_months || null;
  const nextKm = ik && lastKm != null ? lastKm + ik : null;
  const nextDate = im && lastDate ? addMonthsDay(lastDate, im) : null;
  const kmLeft = nextKm != null && currentKm != null ? Math.round(nextKm - currentKm) : null;
  const daysLeft = nextDate ? Math.round((Date.parse(`${nextDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : null;
  if (!ik && !im) return { lastKm, lastDate, nextKm, nextDate, kmLeft, daysLeft, status: "sem-regra" };
  const over = (kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft <= 0);
  const near = (kmLeft != null && ik != null && kmLeft <= ik * 0.1) || (daysLeft != null && daysLeft <= 30);
  return { lastKm, lastDate, nextKm, nextDate, kmLeft, daysLeft, status: over ? "vencida" : near ? "perto" : "em-dia" };
}

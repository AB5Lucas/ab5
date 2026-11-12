import { normalizePlate } from "./fleet-costs";

/** Frota › Notas: abastecimentos lidos dos XML do posto, conferência com as notas, rateio e centro de custo. */

export type FuelNoteRow = {
  access_key: string; item_no: number; xml_file: string; issued_at: string | null; nf_number: string | null; issuer: string | null;
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
/** "ANDRE DE JESUS" → "Andre de Jesus": maiúscula só na primeira letra de cada nome (da/de/do/dos/e ficam minúsculos). */
export const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\s+(D[aeo]s?|E)\s+/g, (m) => m.toLowerCase());

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
/**
 * Lê um XML do posto: um abastecimento por item de combustível da nota (ex.: Diesel S10 + Arla viram duas linhas,
 * cada uma pode ir para uma placa). Sem item de combustível, uma linha com a nota toda. Null se não for NF-e/NFC-e.
 */
export function parseFuelXml(xml: string, fileName: string): FuelNoteRow[] | null {
  if (!/<(?:\w+:)?infNFe\b/.test(xml)) return null;
  const key = xml.match(/Id="NFe(\d{44})"/)?.[1] ?? tag(xml, "chNFe") ?? fileName.replace(/\D/g, "").match(/\d{44}/)?.[0] ?? null;
  if (!key) return null;
  const items = tags(xml, "det").map((d) => ({
    name: tag(d, "xProd") ?? "", qty: num(tag(d, "qCom")), price: num(tag(d, "vUnCom")), value: num(tag(d, "vProd")), comb: /<(?:\w+:)?comb\b/.test(d),
    net: (num(tag(d, "vProd")) ?? 0) - (num(tag(d, "vDesc")) ?? 0) + (num(tag(d, "vOutro")) ?? 0) + (num(tag(d, "vFrete")) ?? 0) + (num(tag(d, "vSeg")) ?? 0),
  }));
  const combItems = items.filter((i) => i.comb);
  const named = items.filter((i) => FUEL.test(i.name));
  const fuels = combItems.length ? combItems : named.length ? named : items;
  const obs = [...xml.matchAll(/<(?:\w+:)?obsCont[^>]*xCampo="([^"]*)"[^>]*>([\s\S]*?)<\/(?:\w+:)?obsCont>/g)]
    .map((m) => `${decode(m[1]!)}: ${tag(m[2]!, "xTexto") ?? ""}`);
  const info = [tag(xml, "infCpl"), ...obs].filter(Boolean).join(" | ");
  const fields = infoFields(info);
  const nf = (tag(xml, "nNF") ?? "").replace(/\D/g, "") || null;
  const noteTotal = num(tag(xml, "vNF")) ?? (fuels.reduce((s, i) => s + (i.value ?? 0), 0) || null);
  const base = {
    access_key: key, xml_file: fileName, issued_at: tag(xml, "dhEmi") ?? (tag(xml, "dEmi") ? `${tag(xml, "dEmi")}T12:00:00-03:00` : null),
    nf_number: nf, issuer: tag(tags(xml, "emit")[0] ?? "", "xFant") ?? tag(tags(xml, "emit")[0] ?? "", "xNome"),
    plate: fields.plate, km: fields.km, driver: fields.driver, info: info || null,
  };
  // Mais de um item de combustível: uma linha por item. Senão, uma linha só (como antes).
  const groups = (combItems.length || named.length) && fuels.length > 1 ? fuels.map((i) => [i]) : [fuels];
  // Cada linha fica com o valor líquido do seu item; o que sobra da nota (outros itens, arredondamento) vai para a última.
  const cents = groups.map((g) => Math.round(g.reduce((s, i) => s + i.net, 0) * 100));
  if (noteTotal != null) cents[cents.length - 1] = cents[cents.length - 1]! + Math.round(noteTotal * 100) - cents.reduce((s, c) => s + c, 0);
  return groups.map((g, idx) => {
    const qty = g.reduce((s, i) => s + (i.qty ?? 0), 0);
    const value = g.reduce((s, i) => s + (i.value ?? 0), 0);
    return {
      ...base, item_no: idx + 1,
      fuel: [...new Set(g.map((i) => i.name).filter(Boolean))].join(" + ") || null,
      quantity: qty ? Math.round(qty * 1000) / 1000 : null,
      unit_price: qty ? Math.round((value / qty) * 10000) / 10000 : g[0]?.price ?? null,
      total: groups.length === 1 ? noteTotal : cents[idx]! / 100,
    };
  });
}

// ---------- Placa e motorista da nota → cadastro ----------
const lev = (a: string, b: string) => {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return d[b.length]!;
};
// Letras e números que se confundem na escrita (O/0, I/1...).
const LOOKS: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6", T: "7" };
const looksSame = (a: string, b: string) => a.length === b.length && [...a].every((c, i) => c === b[i] || LOOKS[c] === b[i] || LOOKS[b[i]!] === c);

/**
 * Placa da nota → placa cadastrada mais próxima. A placa antiga já vira Mercosul (ECM8414 = ECM8E14); depois vale a
 * igual, a que só troca letra por número parecido (O/0, I/1) e, por fim, a com até 2 caracteres diferentes, desde que
 * uma só fique mais perto. `preferred` (placas liberadas no posto) é procurada antes de `all` (todas as cadastradas).
 */
export function closestPlate(raw: string | null | undefined, preferred: string[], all: string[] = []): string | null {
  const p = normalizePlate(raw ?? "");
  if (!p) return null;
  for (const list of [preferred, all]) {
    const plates = [...new Set(list.map((x) => normalizePlate(x)).filter(Boolean))];
    if (plates.includes(p)) return p;
    const looks = plates.filter((x) => looksSame(p, x));
    if (looks.length === 1) return looks[0]!;
    const scored = plates.map((x) => ({ x, d: lev(p, x) })).filter((s) => s.d <= 2).sort((a, b) => a.d - b.d);
    if (scored.length && (scored.length === 1 || scored[1]!.d > scored[0]!.d)) return scored[0]!.x;
  }
  return p;
}

const NAME_STOP = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);
const nameTokens = (s: string) => plain(s).replace(/[^A-Z ]/g, " ").split(/\s+/).filter((t) => t && !NAME_STOP.has(t));
const tokenHit = (w: string, words: string[]) =>
  words.some((x) => x === w || (w.length === 1 && x.startsWith(w)) || (w.length >= 4 && x.length >= 4 && lev(w, x) <= 1));

/**
 * Nome escrito na nota → nome completo cadastrado. O primeiro nome tem que bater (aceita 1 letra errada) e as outras
 * palavras escritas têm que estar no nome cadastrado (iniciais e 1 letra errada valem). Só casa se um único
 * colaborador combinar; `preferred` (motoristas liberados no posto) é procurada antes de `all`. Só o primeiro nome
 * escrito casa apenas se for o único motorista liberado com esse primeiro nome.
 */
export function matchDriverName(written: string | null | undefined, preferred: string[], all: string[] = []): string | null {
  const ws = nameTokens(written ?? "");
  if (!ws.length) return null;
  for (const [i, list] of [preferred, all].entries()) {
    const names = [...new Set(list)];
    const hits = names.filter((full) => {
      const words = nameTokens(full);
      if (!words.length || !tokenHit(ws[0]!, [words[0]!])) return false;
      if (ws.length === 1) return i === 0;
      const rest = ws.slice(1);
      const missing = rest.filter((w) => !tokenHit(w, words.slice(1))).length;
      return missing === 0 || (rest.length >= 3 && missing === 1);
    });
    if (hits.length === 1) return hits[0]!;
  }
  return null;
}

// ---------- Rateio, centro de custo e item conta ----------
export type RateioClient = { id: string; name: string; cc_prefix: string | null };
export type RateioWork = { id: string; client_id: string | null; cc_suffix: string | null; active: boolean };
export type ItemAccount = { cc_code: string; item_account: string; description?: string | null };
export type RateioSchedule = { vehicle_id: string; schedule_date: string; client_id: string | null; extra_client_ids?: string[] | null; is_maintenance?: boolean | null; km?: number | null; trips?: number | null; extra_km?: number | null };
export type RateioPart = { client_id: string; client: string; days: number; km?: number; pct: number; value: number; cc: string | null; cc_rule: string; item_account: string | null };
/** basis: "km" = pelo km rodado em cada cliente; "dias" = sem km lançado, pelos dias (rateios antigos não têm). */
export type Rateio = { from: string; to: string; fallback: boolean; basis?: "km" | "dias"; parts: RateioPart[] };

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const isoDay = (ts: string | null) => {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts.slice(0, 10) : new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
};

/**
 * CC do cliente: com um único serviço ativo, o CC dele; com mais de um (ou o único sem sufixo), o almoxarifado
 * (final 999). Cliente sem prefixo cadastrado (ex.: Pátio) usa o CC da tabela Item Conta com o mesmo nome no rateio.
 */
export function clientCc(client: RateioClient | undefined, works: RateioWork[], accounts: ItemAccount[] = []): { cc: string | null; rule: string } {
  const prefix = (client?.cc_prefix ?? "").trim();
  if (!prefix) {
    const byName = accounts.filter((a) => sameName(a.description, client?.name));
    return byName.length === 1 ? { cc: byName[0]!.cc_code.trim(), rule: "CC da tabela Item Conta (cliente sem prefixo)" } : { cc: null, rule: "cliente sem prefixo de CC" };
  }
  const own = works.filter((w) => w.client_id === client!.id && w.active);
  if (own.length === 1) {
    const suffix = (own[0]!.cc_suffix ?? "").trim();
    return suffix ? { cc: `${prefix}${suffix}`, rule: "único serviço" } : { cc: `${prefix}999`, rule: "único serviço sem sufixo de CC: almoxarifado" };
  }
  return { cc: `${prefix}999`, rule: own.length ? `${own.length} serviços: almoxarifado` : "sem serviço ativo: almoxarifado" };
}
const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && plain(a).replace(/[^A-Z0-9]/g, "") === plain(b).replace(/[^A-Z0-9]/g, "");

/**
 * Item conta pela tabela Item Conta (rateio = nome do cliente, centro de custo, item conta):
 * CC exato; se o mesmo CC tiver mais de uma linha (ex.: 1001999 Indústria e Pátio), vale a do rateio com o
 * nome do cliente. Sem CC na tabela, tenta o prefixo do cliente (4 dígitos) e, por fim, só o nome do rateio.
 */
export function itemAccountFor(cc: string | null, accounts: ItemAccount[], clientName?: string | null): string | null {
  const pick = (list: ItemAccount[]) =>
    list.length === 1 ? list[0]!.item_account : list.find((a) => sameName(a.description, clientName))?.item_account ?? null;
  if (cc) {
    const exact = accounts.filter((a) => a.cc_code.trim() === cc);
    if (exact.length) return pick(exact);
    const prefix = accounts.filter((a) => a.cc_code.trim() === cc.slice(0, 4));
    if (prefix.length) return pick(prefix);
  }
  const byName = accounts.filter((a) => sameName(a.description, clientName));
  return byName.length === 1 ? byName[0]!.item_account : null;
}

/**
 * Rateio de um abastecimento: km que o veículo rodou em cada cliente (Transporte) desde o abastecimento anterior
 * até este (sem km lançado, os dias). Sem programação no período, usa o último dia programado antes dele.
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
  // Peso = km rodados em cada cliente no período: km da programação × 2 × viagens para o cliente principal e o
  // km extra dividido entre os clientes extras do dia. Sem km lançado no período, cai para os dias (como antes).
  const kmWeight = new Map<string, number>();
  for (const s of days) {
    const main = s.client_id ? Number(s.km ?? 0) * 2 * Math.max(1, Number(s.trips ?? 1)) : 0;
    const extras = [...new Set((s.extra_client_ids ?? []).filter((c) => c && c !== s.client_id))];
    if (s.client_id && main > 0) kmWeight.set(s.client_id, (kmWeight.get(s.client_id) ?? 0) + main);
    const extraKm = Number(s.extra_km ?? 0);
    if (extras.length && extraKm > 0) for (const c of extras) kmWeight.set(c, (kmWeight.get(c) ?? 0) + extraKm / extras.length);
  }
  const byKm = [...kmWeight.values()].some((v) => v > 0);
  const weight = new Map<string, number>();
  if (byKm) for (const [c, v] of kmWeight) { if (v > 0) weight.set(c, v); }
  else {
    const byDate = new Map<string, RateioSchedule[]>();
    for (const s of days) byDate.set(s.schedule_date, [...(byDate.get(s.schedule_date) ?? []), s]);
    for (const list of byDate.values()) {
      const cs = [...new Set(list.flatMap(clientsOf))];
      for (const c of cs) weight.set(c, (weight.get(c) ?? 0) + 1 / cs.length);
    }
  }
  const sum = [...weight.values()].reduce((s, v) => s + v, 0);
  const totalCents = Math.round(opts.total * 100);
  let given = 0;
  const parts = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([id, w], i, all) => {
    const cents = i === all.length - 1 ? totalCents - given : Math.round((totalCents * w) / sum);
    given += cents;
    const client = opts.clients.get(id);
    let { cc, rule } = clientCc(client, opts.works, opts.accounts);
    let item = itemAccountFor(cc, opts.accounts, client?.name);
    // O CC calculado não está na tabela Item Conta para este cliente, mas o rateio tem uma linha com o nome dele
    // (ex.: ADM → linha "ADM" no CC 2000 da Diretoria): vale a linha da tabela.
    if (!item) {
      const byName = opts.accounts.filter((a) => sameName(a.description, client?.name));
      if (byName.length === 1) { cc = byName[0]!.cc_code.trim(); item = byName[0]!.item_account; rule = "pelo nome do rateio na tabela Item Conta"; }
    }
    return {
      client_id: id, client: client?.name ?? "Cliente", days: byKm ? 0 : Math.round(w * 100) / 100, km: byKm ? Math.round(w) : undefined,
      pct: Math.round((w / sum) * 10000) / 100, value: cents / 100, cc, cc_rule: rule, item_account: item,
    };
  });
  return { from, to: opts.day, fallback, basis: byKm ? "km" : "dias", parts };
}

/** CC informado à mão no Editar: um ou mais centros de custo, cada um com a sua % do abastecimento. */
export type CcSplitItem = { cc_code: string; item_account: string | null; label: string | null; pct: number };

/** Placas que vão sempre para o mesmo centro de custo, sem rateio pela Transporte (pedido do usuário). */
export const FIXED_PLATE_CC: Record<string, string> = { DAJ5I66: "2004221" };

/** Rateio fixo a partir de CCs informados (à mão ou pela regra da placa): divide o valor pelas % (o último fecha os centavos). */
export function fixedRateio(split: CcSplitItem[], total: number, day: string | null, rule: string, accounts: ItemAccount[]): Rateio {
  const sum = split.reduce((s, x) => s + Number(x.pct || 0), 0) || 100;
  const totalCents = Math.round(total * 100);
  let given = 0;
  const parts = split.map((x, i) => {
    const cents = i === split.length - 1 ? totalCents - given : Math.round((totalCents * Number(x.pct || 0)) / sum);
    given += cents;
    return {
      client_id: `manual:${i}`, client: x.label ?? `CC ${x.cc_code}`, days: 0, pct: Math.round((Number(x.pct || 0) / sum) * 10000) / 100, value: cents / 100,
      cc: x.cc_code, cc_rule: rule, item_account: x.item_account ?? itemAccountFor(x.cc_code, accounts, x.label),
    };
  });
  return { from: day ?? "", to: day ?? "", fallback: false, parts };
}

/** CC fixo da placa (FIXED_PLATE_CC), com rateio e item conta da tabela Item Conta quando o CC tem uma linha só. */
export function plateRuleSplit(plate: string | null, accounts: ItemAccount[]): CcSplitItem[] | null {
  const cc = plate ? FIXED_PLATE_CC[plate] : undefined;
  if (!cc) return null;
  const rows = accounts.filter((a) => a.cc_code.trim() === cc);
  return [{ cc_code: cc, item_account: rows.length === 1 ? rows[0]!.item_account : null, label: rows.length === 1 ? rows[0]!.description ?? null : null, pct: 100 }];
}

/** Situação de uma linha para os filtros. */
export type NoteStatus = "sem-nota" | "pendente" | "aprovada";
export const noteStatus = (n: { note_file: string | null; approved_at: string | null }): NoteStatus =>
  n.approved_at ? "aprovada" : !n.note_file ? "sem-nota" : "pendente";

// ---------- Ranking de entrega de notas ----------
export type RankingNote = { id: string; nf_number: string | null; issued_at: string | null; plate: string | null; plate_fix: string | null; driver: string | null; driver_fix: string | null; total: number | null; note_file: string | null };
export type RankingSchedule = { vehicle_id: string; schedule_date: string; driver_id: string | null; extra_driver_ids?: string[] | null };
export type RankingEntry = {
  key: string; name: string; source: "transporte" | "nota"; total: number; delivered: number; pending: number; waiting: number;
  score: number; pendingNotes: { id: string; nf: string | null; day: string | null; plate: string | null; total: number | null }[];
};
/** Prazo para mandar a foto da nota: abastecimentos mais novos que isso ainda não contam como pendentes. */
export const NOTE_GRACE_DAYS = 2;

/**
 * Ranking de quem entrega a foto da nota. O motorista de cada abastecimento vem da Transporte: o motorista do
 * veículo naquele dia (ou no dia anterior, para abastecimento de madrugada antes da programação); sem
 * programação, vale o nome escrito na nota. Pontuação = % de notas entregues (0 a 100), só com os abastecimentos
 * fora do prazo de entrega; mais abastecimentos desempatam.
 */
export function driverRanking(notes: RankingNote[], schedules: RankingSchedule[], vehicleIdByPlate: Map<string, string>, names: Map<string, string>, today: string): RankingEntry[] {
  const byVehicleDay = new Map<string, RankingSchedule[]>();
  for (const s of schedules) {
    const k = `${s.vehicle_id}|${s.schedule_date}`;
    byVehicleDay.set(k, [...(byVehicleDay.get(k) ?? []), s]);
  }
  const limit = addDays(today, -NOTE_GRACE_DAYS);
  const out = new Map<string, RankingEntry>();
  // Nome escrito na nota → colaborador: todas as palavras do nome escrito estão no cadastro, e só um colaborador combina.
  const tokens = (s: string) => plain(s).replace(/[^A-Z ]/g, " ").split(/\s+/).filter((t) => t.length > 2);
  const people = [...names.entries()].map(([id, nm]) => ({ id, words: new Set(tokens(nm)) }));
  const nameCache = new Map<string, string | null>();
  const byWrittenName = (written: string) => {
    if (nameCache.has(written)) return nameCache.get(written)!;
    const ws = tokens(written);
    const hits = ws.length >= 2 ? people.filter((p) => ws.every((w) => p.words.has(w))) : [];
    const id = hits.length === 1 ? hits[0]!.id : null;
    nameCache.set(written, id);
    return id;
  };
  for (const n of notes) {
    const day = isoDay(n.issued_at);
    const plate = normalizePlate(n.plate_fix ?? n.plate ?? "") || null;
    const vehicleId = plate ? vehicleIdByPlate.get(plate) : undefined;
    let driverId: string | null = null;
    if (vehicleId && day) {
      for (const d of [day, addDays(day, -1)]) {
        const s = (byVehicleDay.get(`${vehicleId}|${d}`) ?? []).find((x) => x.driver_id) ?? null;
        if (s?.driver_id) { driverId = s.driver_id; break; }
      }
    }
    const written = (n.driver_fix ?? n.driver ?? "").trim();
    const fromTransport = !!driverId;
    if (!driverId && written) driverId = byWrittenName(written);
    const key = driverId ? `id:${driverId}` : written ? `nome:${plain(written).replace(/\s+/g, " ")}` : "sem-motorista";
    const name = driverId ? names.get(driverId) ?? "Motorista" : written || "Sem motorista identificado";
    const e = out.get(key) ?? { key, name, source: fromTransport ? "transporte" : "nota", total: 0, delivered: 0, pending: 0, waiting: 0, score: 0, pendingNotes: [] };
    if (fromTransport) e.source = "transporte";
    e.total++;
    if (n.note_file) e.delivered++;
    else if (day && day > limit) e.waiting++;
    else { e.pending++; e.pendingNotes.push({ id: n.id, nf: n.nf_number, day, plate, total: n.total }); }
    out.set(key, e);
  }
  for (const e of out.values()) {
    const counted = e.delivered + e.pending;
    e.score = counted ? Math.round((e.delivered / counted) * 100) : 100;
    e.pendingNotes.sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }
  return [...out.values()].sort((a, b) => b.score - a.score || (b.delivered + b.pending) - (a.delivered + a.pending) || a.name.localeCompare(b.name, "pt-BR"));
}

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

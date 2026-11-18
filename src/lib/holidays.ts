/**
 * Feriados (Configurações › Feriados): nacionais e de Mogi Guaçu entram sozinhos (holidays_sync_year); feriados das
 * outras cidades ficam no catálogo (city_holiday_catalog) e viram aviso na Programação quando há equipe escalada num
 * cliente daquela cidade; client_holidays guarda as exceções por cliente (feriado só do cliente ou feriado geral trabalhado).
 */
export type CityHoliday = { id?: string; city: string; month: number | null; day: number | null; easter_offset: number | null; name: string; auto: boolean; from_year: number | null };
export type ClientHoliday = { client_id: string; date: string; is_holiday: boolean; name: string | null };

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), igual ao easter_date do banco. */
export function easterDate(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), dy = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(mo).padStart(2, "0")}-${String(dy).padStart(2, "0")}`;
}
const addDays = (iso: string, n: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Data do feriado da cidade no ano (fixo ou pela Páscoa); null se ainda não vale. */
export function cityHolidayDate(c: CityHoliday, year: number): string | null {
  if (c.from_year && year < c.from_year) return null;
  if (c.easter_offset != null) return addDays(easterDate(year), c.easter_offset);
  if (!c.month || !c.day) return null;
  return `${year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

export const normCity = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** Feriados das cidades que caem na data (só os não automáticos: os automáticos já estão em holidays). */
export function cityHolidaysOn(catalog: CityHoliday[], city: string | null | undefined, date: string): CityHoliday[] {
  const k = normCity(city);
  const y = Number(date.slice(0, 4));
  return catalog.filter((c) => !c.auto && normCity(c.city) === k && cityHolidayDate(c, y) === date);
}

/** É feriado para o cliente? Geral (holidays) salvo exceção "trabalhado" do cliente, ou feriado só do cliente. */
export function isHolidayFor(date: string, clientId: string | null | undefined, global: ReadonlySet<string>, overrides: Map<string, boolean>): boolean {
  const o = clientId ? overrides.get(`${clientId}|${date}`) : undefined;
  return o ?? global.has(date);
}
export const overrideMap = (rows: ClientHoliday[]) => new Map(rows.map((r) => [`${r.client_id}|${r.date}`, r.is_holiday]));

/** Lista de datas de feriado de um cliente (para quem recebe a lista pronta, como o cálculo de mão de obra). */
export function holidaysForClient(global: readonly string[], clientId: string | null | undefined, rows: ClientHoliday[]): string[] {
  if (!clientId) return [...global];
  const mine = rows.filter((r) => r.client_id === clientId);
  const out = new Set(global);
  for (const r of mine) { if (r.is_holiday) out.add(r.date); else out.delete(r.date); }
  return [...out];
}

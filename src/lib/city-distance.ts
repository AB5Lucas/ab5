// Distância do prêmio viagem: cidade do colaborador → cidade da obra.
// Sem cidade, cidade = base (Mogi Guaçu) ou par desconhecido: usa a distância cadastrada no cliente/obra (base → obra).
export const normCity = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const BASE = "mogi guacu";

export type CityDistanceRow = { city_a: string; city_b: string; km: number | string };

export function buildDistanceLookup(rows: CityDistanceRow[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const a = normCity(r.city_a), b = normCity(r.city_b);
    map.set(`${a}|${b}`, Number(r.km));
    map.set(`${b}|${a}`, Number(r.km));
  }
  return (homeCity: string | null | undefined, workCity: string | null | undefined, fallbackKm: number) => {
    const h = normCity(homeCity), w = normCity(workCity);
    if (!h || h === BASE || !w) return fallbackKm;
    if (h === w) return 0;
    return map.get(`${h}|${w}`) ?? fallbackKm;
  };
}

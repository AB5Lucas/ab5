import { excelDate, moneyCents } from "./billing-sync";

/** Referência de custo por km rodado (aba Transporte › Manutenção); não é o orçado. */
export const BUDGET_KM_RATE = 1.35;

/** Planilhas de Compras no SharePoint (mesma unidade usada por Compras/RELATÓRIOS). */
const CONFERENCIA = "Compras/04 COMPRAS/03 RATEIOS E CONFERÊNCIAS/02 CONFERÊNCIA";
export const MAINTENANCE_FILE = `${CONFERENCIA}/03 MANUTENÇÃO VEICULAR/ROMILDO/NFS - Romildo.xlsx`;
export const fuelFile = (year: number) => `${CONFERENCIA}/Posto - Guaçu Brasil.${year}.xlsm`;

/**
 * Placa no padrão Mercosul, sem espaço: "FRE 2810" → "FRE2I10". Planilhas e cadastro misturam os dois
 * padrões, então os dois lados passam por aqui antes de comparar.
 */
export function normalizePlate(v: unknown): string {
  const p = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{3}\d{4}$/.test(p) ? p.slice(0, 4) + String.fromCharCode(65 + Number(p[4])) + p.slice(5) : p;
}

export type FleetExpenseRow = { plate: string; date: string; amount: number; document: string; description: string };

const norm = (v: unknown) => String(v ?? "").trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
function headerIndex(rows: unknown[][], required: string[]) {
  const h = rows.findIndex((r) => required.every((name) => r.some((c) => norm(c) === name)));
  const head = (rows[h] ?? []).map(norm);
  const col = (...names: string[]) => head.findIndex((c) => names.includes(c));
  return { h, col };
}
const amountOf = (v: unknown) => { const c = moneyCents(v); return c === null ? null : c / 100; };

/** Planilha do Romildo (aba ROMILDO): DT EMISSÃO, PLACA e o valor da OS (bruto). */
export function parseMaintenance(rows: unknown[][]): FleetExpenseRow[] {
  const { h, col } = headerIndex(rows, ["DT EMISSAO", "PLACA"]);
  if (h < 0) throw new Error("Cabeçalho da planilha do Romildo não encontrado (DT EMISSÃO / PLACA)");
  const cDate = col("DT EMISSAO"), cPlate = col("PLACA"), cValue = col("R$/OS", "VALOR BRUTO"), cNf = col("NF"), cOs = col("OS");
  if (cValue < 0) throw new Error("Coluna de valor (R$/OS) não encontrada na planilha do Romildo");
  const out: FleetExpenseRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const date = excelDate(r[cDate]); const plate = normalizePlate(r[cPlate]); const amount = amountOf(r[cValue]);
    if (!date || !plate || !amount) continue;
    out.push({ plate, date, amount, document: [cNf >= 0 && r[cNf] ? `NF ${r[cNf]}` : "", cOs >= 0 && r[cOs] ? `OS ${r[cOs]}` : ""].filter(Boolean).join(" · "), description: "Manutenção" });
  }
  return out;
}

/** Planilha do posto (aba CONTROLE): DATA, PLACA e R$ TOTAL; cada linha já é a parte do abastecimento. */
export function parseFuel(rows: unknown[][]): FleetExpenseRow[] {
  const { h, col } = headerIndex(rows, ["DATA", "PLACA", "R$ TOTAL"]);
  if (h < 0) throw new Error("Cabeçalho da planilha do posto não encontrado (DATA / PLACA / R$ TOTAL)");
  const cDate = col("DATA"), cPlate = col("PLACA"), cValue = col("R$ TOTAL"), cNf = col("NO NF", "Nº NF", "N NF"), cFuel = col("COMBUSTIVEL"), cLiters = col("QTD (L)");
  const out: FleetExpenseRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const date = excelDate(r[cDate]); const plate = normalizePlate(r[cPlate]); const amount = amountOf(r[cValue]);
    if (!date || !plate || !amount) continue;
    const liters = cLiters >= 0 && typeof r[cLiters] === "number" ? ` · ${(r[cLiters] as number).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L` : "";
    out.push({ plate, date, amount, document: cNf >= 0 && r[cNf] ? `NF ${r[cNf]}` : "", description: `${cFuel >= 0 ? String(r[cFuel] ?? "").trim() : "Combustível"}${liters}` });
  }
  return out;
}

/** Programação de um veículo no dia, como vem de vehicle_schedules. */
export type ScheduleKm = { km: number | null; trips: number | null; extra_km: number | null; is_suzano_local?: boolean | null; client?: { has_toll: boolean | null; toll_amount: number | null } | null };
/** Km rodados no dia: ida e volta por viagem, mais o km extra. */
export const dayKm = (s: ScheduleKm) => Number(s.km ?? 0) * 2 * Math.max(1, Number(s.trips ?? 1)) + Number(s.extra_km ?? 0);
/** Pedágio do dia, como já calculado no sistema (ida e volta por viagem; Suzano Local não paga). */
export const dayToll = (s: ScheduleKm) => (s.client?.has_toll && !s.is_suzano_local ? Number(s.client.toll_amount ?? 0) * 2 * Math.max(1, Number(s.trips ?? 1)) : 0);

export type VehicleMonth = { km: number; kmCost: number; budget: number; toll: number; fuel: number; maintenance: number; rent: number; real: number; diff: number };
const r2 = (v: number) => Math.round(v * 100) / 100;
/**
 * Mês de um veículo. Orçado = parte do transporte orçado dos serviços (ver serviceTransportBudget),
 * rateada pelo km; km × 1,35 fica só como referência. Real = combustível + manutenção + pedágio + locação.
 */
export function vehicleMonth(km: number, budget: number, toll: number, fuel: number, maintenance: number, rent: number): VehicleMonth {
  const real = r2(fuel + maintenance + toll + rent);
  return { km, kmCost: r2(km * BUDGET_KM_RATE), budget: r2(budget), toll, fuel, maintenance, rent, real, diff: r2(budget - real) };
}


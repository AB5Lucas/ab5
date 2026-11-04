import type { CcItem, PurchaseCategory } from "./purchases";

export const normalizePurchaseText = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
export type ExclusionRule = { id?: string; match_type: "code" | "prefix"; value: string; reason: string; active: boolean };
export type CcRedirect = { id?: string; source_cc: string; target_cc: string; active: boolean };
export type AssetDecision = { item_key: string; is_asset: boolean; mode: "pending" | "integral" | "installments"; months: number; monthly_amount: number | null; category: string; decided_amount: number };
export type PurchaseItemState = { key: string; index: number; status: "excluded" | "pending" | "launched"; reason: string | null; asset: boolean; category: string | null; excluded: number; pending: number; launched: number };

export const DEFAULT_EXCLUSION_RULES: ExclusionRule[] = [
  { match_type: "prefix", value: "VC", reason: "Incluso no km rodado", active: true },
  ...["SP00064", "SP00010", "RH00062"].map((value): ExclusionRule => ({ match_type: "code", value, reason: "Incluso no km rodado", active: true })),
  { match_type: "code", value: "RH00043", reason: "Incluso no VT", active: true },
  ...["RH00026", "RH00024", "RH00013", "RH00060", "RH00029", "RH00064", "RH00035"].map((value): ExclusionRule => ({ match_type: "code", value, reason: "Incluso nos encargos", active: true })),
];

export function exclusionReason(code: string, rules: ExclusionRule[]): string | null {
  const c = normalizePurchaseText(code);
  const rule = rules.filter((r) => r.active).sort((a, b) => Number(a.match_type === "prefix") - Number(b.match_type === "prefix")).find((r) => r.match_type === "prefix" ? c.startsWith(normalizePurchaseText(r.value)) : c === normalizePurchaseText(r.value));
  return rule?.reason ?? null;
}

/** Identity ignores price, preserves repeated identical source rows by occurrence. */
export function purchaseItemKeys(items: CcItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = JSON.stringify([normalizePurchaseText(item.code), normalizePurchaseText(item.desc), item.qty, item.date ?? null]);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}#${occurrence}`;
  });
}

export function detectPurchaseAsset(item: CcItem): "vehicle" | "equipment" | null {
  if (Math.round(item.amount * 100) < 2000000) return null;
  const d = normalizePurchaseText(item.desc);
  const code = normalizePurchaseText(item.code);
  if (/LOCAC|ALUGUEL|SERVIC|FRETE|MANUTEN|REPARO|PECAS?|OLEO|PNEU|LAVAGEM|RASTREAMENTO|ADESIVO|PEDAGIO|MULTA|ENERGIA|GAS|AGUA|ESGOTO|REMOVEDOR|TINTA|QUIMIC|TYVEK|MACACAO|SOMBRITE|EPI\b|CONSUMO|COMBUSTIVEL|ABASTEC|ADITIVO/.test(d)) return null;
  if (/^(EP|PQ|CBBC|AE)/.test(code)) return null;
  if (code.startsWith("VC") && /\b(?:19|20)\d{2}\b/.test(d)) return "vehicle";
  if (/\b(VOLKSWAGEN|KOMBI|FIAT|CHEVROLET|RENAULT|TOYOTA|FORD|CAMINHAO|VEICULO|AUTOMOVEL|ONIBUS)\b/.test(d) && /\b(?:19|20)\d{2}\b/.test(d)) return "vehicle";
  if (/\b(MAQUINA|EQUIPAMENTO|COMPRESSOR|GERADOR|EMPILHADEIRA|MOTOR)\b/.test(d) || /(?:MAQUINA|INVERSORA|APARELHO|EQUIPAMENTO).*SOLDA/.test(d)) return "equipment";
  return null;
}

export function effectivePurchaseCc(cc: string, redirects: CcRedirect[], manual: boolean): string {
  if (manual) return cc;
  // One hop only: destination behaves exactly like that source CC, without cycles.
  return redirects.find((r) => r.active && r.source_cc === cc)?.target_cc ?? cc;
}

export function installmentPlan(total: number, startMonth: string, months = 12, monthlyAmount?: number | null): { month: string; amount: number }[] {
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(months) || months < 1 || months > 120 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) throw new Error("Valor ou período de parcelas inválido");
  const cents = Math.round(total * 100);
  const monthly = monthlyAmount == null ? Math.round(cents / months) : Math.round(monthlyAmount * 100);
  if (!Number.isFinite(monthly) || monthly <= 0 || monthly * (months - 1) >= cents) throw new Error("O valor mensal deve deixar uma última parcela positiva");
  const [year = 0, month = 1] = startMonth.split("-").map(Number);
  return Array.from({ length: months }, (_, i) => ({ month: new Date(Date.UTC(year, month - 1 + i, 1)).toISOString().slice(0, 7), amount: (i === months - 1 ? cents - monthly * (months - 1) : monthly) / 100 }));
}

export function assetCategory(item: CcItem): PurchaseCategory {
  return detectPurchaseAsset(item) === "vehicle" || normalizePurchaseText(item.code).startsWith("VC") ? "transporte" : "materiais";
}

export type EntryFilter = { from: string; to: string; category: string; description: string };
export function filterPurchaseEntries<T extends { entry_date: string; category: string; description?: string | null }>(entries: T[], filter: EntryFilter): T[] {
  const query = normalizePurchaseText(filter.description);
  return entries.filter((entry) => (!filter.from || entry.entry_date >= filter.from) && (!filter.to || entry.entry_date <= filter.to) && (!filter.category || entry.category === filter.category || (filter.category === "transporte" && entry.category === "terceiros") || (filter.category === "mo" && entry.category === "mao_obra")) && (!query || normalizePurchaseText(entry.description ?? "").includes(query)));
}
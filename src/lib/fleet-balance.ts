/**
 * Saldo do posto (Frota › Abastecimento): limite de R$ 50.000 menos as faturas em aberto (Pago? = NÃO) e menos os
 * abastecimentos do posto Guaçu Brasil ainda não faturados (depois do fim da última fatura lida). Não depende do
 * período filtrado — antes a quinzena já faturada entrava duas vezes (na fatura e no total do período).
 */
export const FLEET_CREDIT = 50000;
export const BALANCE_WARN = 3000;
export const BALANCE_DANGER = 1000;

export const fleetBalance = (openInvoices: number, unbilled: number) =>
  Math.round((FLEET_CREDIT - openInvoices - unbilled) * 100) / 100;

/** CNPJ do posto das faturas (Guaçu Brasil), posições 7–20 do código de acesso da NF. */
export const GUACU_CNPJ = "09429269000162";

/** Cor do número no quadro Saldo: vermelho com R$ 1.000 ou menos, laranja com R$ 3.000 ou menos. */
export const balanceTone = (v: number): "bad" | "warn" | undefined =>
  v <= BALANCE_DANGER ? "bad" : v <= BALANCE_WARN ? "warn" : undefined;

/** Aviso (!) no menu Abastecimento: vermelho abaixo de R$ 1.000, laranja abaixo de R$ 3.000. */
export const balanceBadgeTone = (v: number): "red" | "orange" | undefined =>
  v < BALANCE_DANGER ? "red" : v < BALANCE_WARN ? "orange" : undefined;

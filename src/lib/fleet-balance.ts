/**
 * Saldo do posto (Frota › Abastecimento): limite fixo de R$ 40.000 menos as faturas em aberto (Pago? = NÃO)
 * e menos o total abastecido no período.
 */
export const FLEET_CREDIT = 40000;
export const BALANCE_WARN = 3000;
export const BALANCE_DANGER = 1000;

export const fleetBalance = (openInvoices: number, periodTotal: number) =>
  Math.round((FLEET_CREDIT - openInvoices - periodTotal) * 100) / 100;

/** Cor do número no quadro Saldo: vermelho com R$ 1.000 ou menos, laranja com R$ 3.000 ou menos. */
export const balanceTone = (v: number): "bad" | "warn" | undefined =>
  v <= BALANCE_DANGER ? "bad" : v <= BALANCE_WARN ? "warn" : undefined;

/** Aviso (!) no menu Abastecimento: vermelho abaixo de R$ 1.000, laranja abaixo de R$ 3.000. */
export const balanceBadgeTone = (v: number): "red" | "orange" | undefined =>
  v < BALANCE_DANGER ? "red" : v < BALANCE_WARN ? "orange" : undefined;

import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { isoDay, withDateFix } from "@/lib/fleet-notes";
import { GUACU_CNPJ } from "@/lib/fleet-balance";
import { nonTicketTotal } from "@/lib/fleet-fiscal";

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** Partes do Saldo: faturas em aberto e abastecimentos do Guaçu Brasil depois do fim da última fatura (sem TICKET).
 * Arquivo leve (sem componentes) porque também é lido pelo "!" do menu. */
export async function fetchFleetBalanceParts() {
  const inv = (await supabase.from("fleet_invoices").select("total, paid, period_to")).data ?? [];
  const open = inv.filter((i) => !i.paid).reduce((s, i) => s + Number(i.total ?? 0), 0);
  const lastBilledTo = inv.map((i) => i.period_to).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const from = lastBilledTo ?? addDays(new Date().toISOString().slice(0, 10), -15);
  const notes = await fetchAll<any>((a, b) => supabase.from("fleet_fuel_notes").select("access_key, issued_at, issued_on_fix, total, approved_at, allocation, cc_split, cc_fix")
    .or(`issued_at.gte.${from},issued_on_fix.gt.${from}`).order("id").range(a, b));
  const unbilled = notes.map(withDateFix)
    .filter((n) => { const d = isoDay(n.issued_at); return !!d && d > from && String(n.access_key ?? "").slice(6, 20) === GUACU_CNPJ; })
    .reduce((s, n) => s + nonTicketTotal(n), 0);
  return { open, unbilled, lastBilledTo };
}

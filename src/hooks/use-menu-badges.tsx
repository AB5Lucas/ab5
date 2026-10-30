import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { addDays, todayISO } from "@/lib/scheduling";

export type MenuBadge = { count: number; tone: "red" | "orange" };

const WARN_DAYS = 30;

/** Contadores discretos do menu lateral: vencidos (vermelho) ou a vencer (laranja) e pendências de sincronização. */
function useBadgeData() {
  return useQuery({
    queryKey: ["menu-badges"],
    refetchInterval: 60000,
    staleTime: 30000,
    queryFn: async () => {
      const today = todayISO();
      const warn = addDays(today, WARN_DAYS);
      const safe = async <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
      const [colabs, asos, trns, ints, appts, conf, purchases, orders, invoices, notes] = await Promise.all([
        safe(fetchAll<any>((a, b) => supabase.from("collaborators").select("id").eq("status", "active").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("asos").select("collaborator_id, expires_at").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("collaborator_trainings").select("collaborator_id, training_id, expires_at").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("client_integrations").select("collaborator_id, client_id, expires_at, documentation").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("appointments").select("collaborator_id, training_id, client_id, type, scheduled_date").eq("status", "agendado").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("conference_items").select("id, collaborator_id, training_id, client_id, type").neq("status", "concluido").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("purchase_cc_lines").select("id").eq("status", "pending").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("industry_orders").select("id").eq("status", "pending").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("industry_invoices").select("id").eq("status", "pending").range(a, b))),
        safe(fetchAll<any>((a, b) => supabase.from("billing_sync_notes").select("id").not("status", "in", '("posted","cancelled")').range(a, b))),
      ]);
      const confIds = new Set(conf.map((c) => c.id));
      const checks = await safe(fetchAll<any>((a, b) => supabase.from("conference_checks").select("item_id, next_check_date").eq("approved", false).range(a, b)));
      const nextByItem = new Map<string, string>();
      for (const c of checks) if (c.next_check_date && confIds.has(c.item_id)) { const cur = nextByItem.get(c.item_id); if (!cur || c.next_check_date < cur) nextByItem.set(c.item_id, c.next_check_date); }
      const conference = { expired: 0, expiring: 0 };
      for (const d of nextByItem.values()) { if (d < today) conference.expired++; else if (d === today) conference.expiring++; }
      const active = new Set(colabs.map((c) => c.id));
      const kindOf = (t: string) => { const s = String(t).toLowerCase(); return s.includes("aso") ? "aso" : s.startsWith("trein") ? "trn" : s.startsWith("integ") ? "int" : ""; };
      const covered = new Set<string>();
      for (const a of [...appts, ...conf]) {
        const k = kindOf(a.type); if (!k) continue;
        covered.add(`${k}|${a.collaborator_id}`);
        if (a.training_id) covered.add(`${k}|${a.collaborator_id}|${a.training_id}`);
        if (a.client_id) covered.add(`${k}|${a.collaborator_id}|${a.client_id}`);
      }
      // Mantém apenas o registro mais recente por colaborador/item.
      const latest = new Map<string, string>();
      const put = (key: string, exp: string | null) => { if (!exp) return; const cur = latest.get(key); if (!cur || exp > cur) latest.set(key, exp); };
      asos.forEach((r) => active.has(r.collaborator_id) && put(`aso|${r.collaborator_id}`, r.expires_at));
      trns.forEach((r) => active.has(r.collaborator_id) && put(`trn|${r.collaborator_id}|${r.training_id}`, r.expires_at));
      ints.forEach((r) => active.has(r.collaborator_id) && !r.documentation && put(`int|${r.collaborator_id}|${r.client_id}`, r.expires_at));
      const byKind: Record<string, { expired: number; expiring: number }> = {
        agendamentos: { expired: appts.filter((a) => a.scheduled_date < today).length, expiring: 0 },
        aso: { expired: 0, expiring: 0 }, int: { expired: 0, expiring: 0 }, trn: { expired: 0, expiring: 0 },
      };
      for (const [key, exp] of latest) {
        const [k, cid] = key.split("|");
        if (covered.has(key) || covered.has(`${k}|${cid}`)) continue;
        if (exp < today) byKind[k!]!.expired++; else if (exp <= warn) byKind[k!]!.expiring++;
      }
      const vals = Object.values(byKind);
      const expired = vals.reduce((a, v) => a + v.expired, 0);
      const expiring = vals.reduce((a, v) => a + v.expiring, 0);
      return { conference, byKind, expired, expiring, purchases: purchases.length, orders: orders.length, billing: invoices.length + notes.length, billingInd: invoices.length, billingSrv: notes.length };
    },
  });
}

const toBadge = (v?: { expired: number; expiring: number }): MenuBadge | undefined =>
  !v ? undefined : v.expired ? { count: v.expired, tone: "red" } : v.expiring ? { count: v.expiring, tone: "orange" } : undefined;

/** Contadores das subabas de Documentação. */
export function useControlBadges() {
  const k = useBadgeData().data?.byKind;
  return { agendamentos: toBadge(k?.["agendamentos"]), asos: toBadge(k?.["aso"]), integracoes: toBadge(k?.["int"]), treinamentos: toBadge(k?.["trn"]) } as Record<string, MenuBadge | undefined>;
}

export function useMenuBadges() {
  const d = useBadgeData().data;
  const out: Record<string, MenuBadge | undefined> = {};
  if (d) {
    if (d.expired) out["/agendamentos"] = { count: d.expired, tone: "red" };
    else if (d.expiring) out["/agendamentos"] = { count: d.expiring, tone: "orange" };
    const c = toBadge(d.conference); if (c) out["/conferencia"] = c;
    if (d.purchases) out["/obras/compras"] = { count: d.purchases, tone: "red" };
    if (d.orders) out["/fechamentos/suzano"] = { count: d.orders, tone: "red" };
    if (d.billing) out["/relatorios/sincronizacao"] = { count: d.billing, tone: "red" };
  }
  return out;
}

const red = (n?: number): MenuBadge | undefined => (n ? { count: n, tone: "red" } : undefined);

/** Contadores das subabas de Faturamento. */
export function useBillingBadges() {
  const d = useBadgeData().data;
  return { servicos: red(d?.billingSrv), industria: red(d?.billingInd) } as Record<string, MenuBadge | undefined>;
}

export function BadgeDot({ b }: { b?: MenuBadge | undefined }) {
  if (!b) return null;
  return (
    <span className={`ml-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums ${b.tone === "red" ? "bg-destructive/85 text-destructive-foreground" : "bg-warning/85 text-warning-foreground"}`}>
      {b.count > 99 ? "99+" : b.count}
    </span>
  );
}

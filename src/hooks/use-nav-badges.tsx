import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { addDays, todayISO } from "@/lib/scheduling";
import { useServiceDistribution } from "@/hooks/use-service-distribution";
import { hiringBadge } from "@/lib/hiring-badge";

export type MenuBadge = { count: number; tone: "red" | "orange"; title?: string };

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
      const [colabs, asos, trns, ints, appts, conf, purchases, orders, invoices, notes, epis] = await Promise.all([
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
        safe(fetchAll<any>((a, b) => supabase.from("epi_sheets").select("collaborator_id, expires_at, archived").range(a, b))),
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
        aso: { expired: 0, expiring: 0 }, int: { expired: 0, expiring: 0 }, trn: { expired: 0, expiring: 0 }, epi: { expired: 0, expiring: 0 },
      };
      for (const [key, exp] of latest) {
        const [k, cid] = key.split("|");
        if (covered.has(key) || covered.has(`${k}|${cid}`)) continue;
        if (exp < today) byKind[k!]!.expired++; else if (exp <= warn) byKind[k!]!.expiring++;
      }
      // Fichas de EPI: todo ativo deve ter; sem ficha conta como vencida; arquivada não sinaliza.
      const epiBy = new Map(epis.map((e) => [e.collaborator_id, e]));
      for (const id of active) {
        const e = epiBy.get(id);
        if (e?.archived) continue;
        if (!e?.expires_at || e.expires_at < today) byKind["epi"]!.expired++; else if (e.expires_at <= warn) byKind["epi"]!.expiring++;
      }
      const vals = Object.values(byKind);
      const expired = vals.reduce((a, v) => a + v.expired, 0);
      const expiring = vals.reduce((a, v) => a + v.expiring, 0);
      return { conference, byKind, expired, expiring, purchases: purchases.length, orders: orders.length, billing: invoices.length + notes.length, billingInd: invoices.length, billingSrv: notes.length };
    },
  });
}

/** Total de pendências (vencidas + a vencer); vermelho se houver ao menos uma vencida. */
const toBadge = (v?: { expired: number; expiring: number }): MenuBadge | undefined =>
  !v || !(v.expired + v.expiring) ? undefined : { count: v.expired + v.expiring, tone: v.expired ? "red" : "orange" };
const conferenceBadge = (v?: { expired: number; expiring: number }): MenuBadge | undefined =>
  !v ? undefined : v.expired ? { count: v.expired, tone: "red" } : v.expiring ? { count: v.expiring, tone: "orange" } : undefined;

/** Contadores das subabas de Documentação. */
export function useControlBadges() {
  const k = useBadgeData().data?.byKind;
  return { agendamentos: toBadge(k?.["agendamentos"]), asos: toBadge(k?.["aso"]), integracoes: toBadge(k?.["int"]), treinamentos: toBadge(k?.["trn"]), epi: toBadge(k?.["epi"]) } as Record<string, MenuBadge | undefined>;
}

export function useMenuBadges() {
  const d = useBadgeData().data;
  const distribution = useServiceDistribution().data;
  const w = useWorkflowBadges().data;
  const out: Record<string, MenuBadge | undefined> = {};
  if (distribution?.pendingClients) out["/programacao/servicos"] = { count: distribution.pendingClients, tone: "red" };
  if (w?.ponto) out["/relatorios/ajuste-ponto"] = { count: w.ponto, tone: "red" };
  if (w?.andaimes) out["/andaimes/solicitacoes"] = { count: w.andaimes, tone: "red" };
  if (w?.hiring) out["/demandas/contratacoes"] = { count: w.hiring, tone: w.hiringTone ?? "red" };
  if (d) {
    const docs = toBadge(d); if (docs) out["/agendamentos"] = docs;
    const c = conferenceBadge(d.conference); if (c) out["/conferencia"] = c;
    if (d.purchases) out["/obras/compras"] = { count: d.purchases, tone: "red" };
    // Vermelho = Serviços, laranja = Indústria; basta 1 da Serviços para ficar vermelho.
    if (d.orders) out["/fechamentos/suzano"] = { count: d.orders, tone: "orange", title: "Pendentes da Indústria" };
    if (d.billing) out["/relatorios/sincronizacao"] = { count: d.billing, tone: d.billingSrv ? "red" : "orange", title: d.billingSrv ? `Pendentes: ${d.billingSrv} da Serviços, ${d.billingInd} da Indústria` : "Pendentes da Indústria" };
  }
  return out;
}

const red = (n?: number): MenuBadge | undefined => (n ? { count: n, tone: "red" } : undefined);

/** Contadores das subabas de Faturamento. */
export function useBillingBadges() {
  const d = useBadgeData().data;
  return { servicos: red(d?.billingSrv), industria: d?.billingInd ? { count: d.billingInd, tone: "orange" } : undefined } as Record<string, MenuBadge | undefined>;
}

export function BadgeDot({ b }: { b?: MenuBadge | undefined }) {
  if (!b) return null;
  return (
    <span className={`ml-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums ${b.tone === "red" ? "bg-destructive/85 text-destructive-foreground" : "bg-warning/85 text-warning-foreground"}`}>
      {b.count > 99 ? "99+" : b.count}
    </span>
  );
}

const SEEN_KEY = (uid: string) => `hiring-seen:${uid}`;
export function readHiringSeen(uid: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY(uid)) || "{}"); } catch { return {}; }
}
/** Marca a solicitação de contratação como vista pelo usuário (zera o aviso dela). */
export function markHiringSeen(uid: string | undefined, reqId: string) {
  if (!uid) return;
  const s = readHiringSeen(uid);
  s[reqId] = new Date().toISOString();
  if (!s["__base"]) s["__base"] = s[reqId];
  localStorage.setItem(SEEN_KEY(uid), JSON.stringify(s));
  window.dispatchEvent(new Event("hiring-seen"));
}

/** Avisos individuais: Ajuste de Ponto, Solicitações de andaimes e Contratações. */
export function useWorkflowBadges() {
  return useQuery({
    queryKey: ["workflow-badges"],
    refetchInterval: 60000,
    staleTime: 30000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return { ponto: 0, andaimes: 0, hiring: 0 };
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const rh = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "programmer");
      const { computeOccurrences, fetchTimeclockData, timeclockDefaultFrom } = await import("@/lib/timeclock");
      const { flowPendingFor } = await import("@/lib/andaimes");
      const [tc, flowRoles, reqs, hires] = await Promise.all([
        fetchTimeclockData(timeclockDefaultFrom(), todayISO()).catch(() => undefined),
        supabase.from("andam_flow_roles").select("key, user_id").then((r) => r.data ?? []),
        supabase.from("andam_requests").select("flow_stage, user_id").neq("flow_stage", "encerrada").then((r) => (r.data ?? []) as any[]),
        supabase.from("hiring_requests").select("id, status, requester_id").then((r) => (r.data ?? []) as any[]),
      ]);
      let ponto = 0;
      if (tc) { const { occs, treated } = computeOccurrences(tc); ponto = occs.filter((o) => !treated.has(o.key)).length; }
      const ids: any = {};
      for (const f of flowRoles as any[]) ids[f.key] = f.user_id;
      const andaimes = reqs.filter((r) => flowPendingFor(r.flow_stage, { ...ids, solicitante: r.user_id }) === uid).length;
      let hiring = 0;
      let hiringTone: "red" | "orange" = "orange";
      if (rh) {
        const badge = hiringBadge(hires);
        hiring = badge?.count ?? 0;
        hiringTone = badge?.tone ?? "orange";
      }
      else {
        const mine = hires.filter((h) => h.requester_id === uid).map((h) => h.id);
        if (mine.length) {
          const seen = readHiringSeen(uid);
          if (!seen["__base"]) { seen["__base"] = new Date().toISOString(); localStorage.setItem(SEEN_KEY(uid), JSON.stringify(seen)); }
          const { data: ev } = await supabase.from("hiring_request_events").select("request_id, user_id, created_at").in("request_id", mine).neq("user_id", uid);
          const unread = (ev ?? []).filter((e: any) => e.created_at > (seen[e.request_id] ?? seen["__base"] ?? ""));
          hiring = unread.length;
          const unreadIds = new Set(unread.map((e) => e.request_id));
          hiringTone = hiringBadge(hires.filter((h) => unreadIds.has(h.id)))?.tone ?? "orange";
        }
      }
      return { ponto, andaimes, hiring, hiringTone };
    },
  });
}

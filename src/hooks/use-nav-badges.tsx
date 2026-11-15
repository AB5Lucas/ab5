import { useQuery } from "@tanstack/react-query";
import { useAccess } from "@/hooks/use-access";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { addDays, todayISO } from "@/lib/scheduling";
import { useServiceDistribution } from "@/hooks/use-service-distribution";
import { useNextBusinessDayAlerts } from "@/hooks/use-schedule-alerts";
import { useSeenAlerts } from "@/hooks/use-seen-alerts";
import { worstAlertTone } from "@/lib/schedule-alerts";
import { hiringBadge } from "@/lib/hiring-badge";
import { balanceBadgeTone, fleetBalance } from "@/lib/fleet-balance";
import { isoDay } from "@/lib/fleet-notes";
import { nonTicketTotal } from "@/lib/fleet-fiscal";
import { currentMonthRange } from "@/components/date-range-picker";

/** Aviso do menu: vermelho = exige ação/vencido; laranja = atenção/a vencer; label "!" = alerta de valor. detail = texto do sino e do mouse. */
export type MenuBadge = { count: number; tone: "red" | "orange"; title?: string; label?: string; detail?: string };


/** Contadores discretos do menu lateral: vencidos (vermelho) ou a vencer (laranja) e pendências de sincronização. */
function useBadgeData() {
  // Cada bloco só é lido por quem acessa a página do aviso (antes todos os usuários liam tudo).
  const { canAccess, loading } = useAccess();
  const can = {
    docs: canAccess("/agendamentos") || canAccess("/conferencia"),
    purchases: canAccess("/obras/compras"),
    orders: canAccess("/fechamentos/suzano"),
    billing: canAccess("/relatorios/sincronizacao"),
    fleet: canAccess("/frota/notas"),
  };
  return useQuery({
    queryKey: ["menu-badges", can],
    enabled: !loading,
    // Atualiza a cada 5 min e quando a janela volta ao foco (a consulta é pesada para todos os usuários).
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const today = todayISO();
      const safe = async <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
      const when = <T,>(ok: boolean, f: () => Promise<T[]>) => (ok ? safe(f()) : Promise.resolve([] as T[]));
      // Saldo do posto como na aba Abastecimento ao abrir (período = mês atual).
      const month = currentMonthRange();
      type Kind = { expired: number; expiring: number };
      type Counts = { byKind: Record<string, Kind>; conference: Kind; purchases: number; orders: number; billingInd: number; billingSrv: number };
      const zero = { expired: 0, expiring: 0 };
      const empty: Counts = { byKind: { agendamentos: zero, aso: zero, int: zero, trn: zero, epi: zero }, conference: zero, purchases: 0, orders: 0, billingInd: 0, billingSrv: 0 };
      // Contagens de Documentação, Conferência, Compras, Pedidos e Faturamento vêm prontas do banco
      // (menu_badge_counts, com a RLS do usuário); antes o navegador baixava as tabelas inteiras.
      const [counts, fleetOpen, fleetNotes] = await Promise.all([
        can.docs || can.purchases || can.orders || can.billing
          ? supabase.rpc("menu_badge_counts" as never, { p_today: today, p_docs: can.docs, p_purchases: can.purchases, p_orders: can.orders, p_billing: can.billing } as never)
            .then((r: { data: unknown; error: unknown }) => (r.error ? empty : (r.data as Counts) ?? empty), () => empty)
          : Promise.resolve(empty),
        when(can.fleet, () => fetchAll<any>((a, b) => supabase.from("fleet_invoices").select("total").eq("paid", false).range(a, b))),
        when(can.fleet, () => fetchAll<any>((a, b) => supabase.from("fleet_fuel_notes").select("issued_at, total, approved_at, allocation, cc_split, cc_fix").gte("issued_at", addDays(month.from, -1)).lte("issued_at", `${addDays(month.to, 1)}T23:59:59`).range(a, b))),
      ]);
      const fleetPeriod = fleetNotes.filter((n) => { const d = isoDay(n.issued_at); return !!d && d >= month.from && d <= month.to; }).reduce((s, n) => s + nonTicketTotal(n), 0);
      const fleetSaldo = fleetBalance(fleetOpen.reduce((s, i) => s + Number(i.total ?? 0), 0), fleetPeriod);
      const byKind = counts.byKind;
      const vals = Object.values(byKind);
      const expired = vals.reduce((a, v) => a + Number(v.expired), 0);
      const expiring = vals.reduce((a, v) => a + Number(v.expiring), 0);
      const { conference, purchases, orders, billingInd, billingSrv } = counts;
      return { fleetSaldo, conference, byKind, expired, expiring, purchases, orders, billing: billingInd + billingSrv, billingInd, billingSrv };
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
  // "!" na Programação: avisos do próximo dia útil (vermelho = alto impacto, laranja = pequeno impacto).
  const next = useNextBusinessDayAlerts().data;
  const { isSeen } = useSeenAlerts();
  const nextPending = next ? next.alerts.filter((x) => !isSeen(next.date, x)) : [];
  const nt = worstAlertTone(nextPending);
  if (next && nt) out["/programacao/diaria"] = { count: nextPending.length, label: "!", tone: nt, detail: `${next.date.split("-").reverse().join("/")}: ${nextPending.map((x) => x.title).join(" · ")}` };
  if (distribution?.pendingClients) out["/programacao/servicos"] = { count: distribution.pendingClients, tone: "red", detail: `${distribution.pendingClients} cliente(s) com distribuição de serviço pendente` };
  if (w?.ponto) out["/relatorios/ajuste-ponto"] = { count: w.ponto, tone: "red", detail: `${w.ponto} ocorrência(s) de ponto sem tratamento` };
  if (w?.andaimes) out["/andaimes/solicitacoes"] = { count: w.andaimes, tone: "red", detail: `${w.andaimes} solicitação(ões) aguardando você` };
  if (w?.hiring) out["/demandas/contratacoes"] = { count: w.hiring, tone: w.hiringTone ?? "red", detail: `${w.hiring} contratação(ões) com novidade` };
  if (d) {
    const docs = toBadge(d);
    if (docs) {
      const names: Record<string, string> = { agendamentos: "Agendamentos atrasados", aso: "ASO", int: "Integrações", trn: "Treinamentos", epi: "Fichas de EPI" };
      const parts = Object.entries(d.byKind).filter(([, v]) => v.expired + v.expiring)
        .map(([k, v]) => `${names[k] ?? k}: ${[v.expired ? `${v.expired} vencido(s)` : "", v.expiring ? `${v.expiring} a vencer` : ""].filter(Boolean).join(", ")}`);
      out["/agendamentos"] = { ...docs, detail: parts.join(" · ") };
    }
    const c = conferenceBadge(d.conference); if (c) out["/conferencia"] = { ...c, detail: c.tone === "red" ? `${c.count} conferência(s) com prazo vencido` : `${c.count} conferência(s) para hoje` };
    const ft = balanceBadgeTone(d.fleetSaldo);
    if (ft) out["/frota/notas"] = { count: 1, label: "!", tone: ft, title: `Saldo do posto: ${d.fleetSaldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` };
    if (d.purchases) out["/obras/compras"] = { count: d.purchases, tone: "red", detail: `${d.purchases} linha(s) de compra pendente(s)` };
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
    <span className={`ml-1.5 min-w-4 rounded-[4px] px-1 text-center text-[10px] font-semibold leading-4 tabular-nums ${b.tone === "red" ? "bg-destructive/85 text-destructive-foreground" : "bg-warning/85 text-warning-foreground"}`}>
      {b.label ?? (b.count > 99 ? "99+" : b.count)}
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
  const { canAccess, loading } = useAccess();
  const can = { ponto: canAccess("/relatorios/ajuste-ponto"), andaimes: canAccess("/andaimes/solicitacoes"), hiring: canAccess("/demandas/contratacoes") };
  return useQuery({
    queryKey: ["workflow-badges", can],
    enabled: !loading,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      // Sessão local (sem ir ao servidor de login a cada atualização).
      const { data: auth } = await supabase.auth.getSession();
      const uid = auth.session?.user?.id;
      if (!uid) return { ponto: 0, andaimes: 0, hiring: 0 };
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const rh = (roles ?? []).some((r: any) => r.role === "admin" || r.role === "programmer");
      const { computeOccurrences, fetchTimeclockData, timeclockDefaultFrom } = await import("@/lib/timeclock");
      const { flowPendingFor } = await import("@/lib/andaimes");
      const [tc, flowRoles, reqs, hires] = await Promise.all([
        can.ponto ? fetchTimeclockData(timeclockDefaultFrom(), todayISO()).catch(() => undefined) : Promise.resolve(undefined),
        can.andaimes ? supabase.from("andam_flow_roles").select("key, user_id").then((r) => r.data ?? []) : Promise.resolve([]),
        can.andaimes ? supabase.from("andam_requests").select("flow_stage, user_id").neq("flow_stage", "encerrada").then((r) => (r.data ?? []) as any[]) : Promise.resolve([] as any[]),
        can.hiring ? supabase.from("hiring_requests").select("id, status, requester_id").then((r) => (r.data ?? []) as any[]) : Promise.resolve([] as any[]),
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

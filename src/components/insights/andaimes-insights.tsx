/**
 * Blocos vivos de Andaimes (Estoque, Solicitações e Acompanhamento):
 * 9. Mapa do estoque por local · 10. Montados há mais tempo · 11. Produtividade da semana · 12. Solicitações por etapa.
 * Escopo: coordenador/encarregado só veem os clientes atribuídos (useAndamScope); a RLS continua mandando.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Boxes, Construction, GitBranch, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetch-all";
import { todayISO } from "@/lib/scheduling";
import { useAndamScope } from "@/hooks/use-andam-scope";
import { useCurrentUser } from "@/hooks/use-auth";
import { pageTabsStore } from "@/lib/page-tabs-store";
import { addDaysIso, shortBR } from "@/lib/insights/dates";
import {
  oldestStanding, requestsByStage, stockByPlace, weeklyProductivity,
  type MoveRow, type RequestRow, type ScaffoldRow, type StockRow, type StructRow,
} from "@/lib/insights/andaimes";
import { CountUp } from "@/components/count-up";
import { Bar, BigNumber, InsightCard, InsightRow, InsightStrip, Sparkline } from "@/components/insights";
import { cn } from "@/lib/utils";

const REFRESH = 2 * 60_000;
const m3 = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m³`;
const pieces = (v: number) => v.toLocaleString("pt-BR");

export type AndaimesHandlers = {
  /** Página de Estoque: aplica o filtro do local na própria página. */
  onPlace?: ((p: { location: string; workId: string | null; clientId: string | null }) => void) | undefined;
  /** Acompanhamento: abre o andaime. */
  onStructure?: ((id: string) => void) | undefined;
  /** Solicitações: filtra pela etapa. */
  onStage?: ((stage: string) => void) | undefined;
  /** Etapa filtrada (destaque). */
  stage?: string | undefined;
};

export function AndaimesInsights({ id, onPlace, onStructure, onStage, stage }: { id: string } & AndaimesHandlers) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const { user } = useCurrentUser();
  const { clients, works } = useAndamScope();
  const today = todayISO();
  const weekAgo = addDaysIso(today, -6);
  const allowed = useMemo(() => new Set(clients.map((c) => c.id)), [clients]);
  const okClient = (c: string | null | undefined) => !c || allowed.has(c);

  const allClients = useQuery({
    queryKey: ["insights", "andam-client-names"],
    staleTime: 10 * 60_000,
    queryFn: async () => (await supabase.from("clients").select("id, name").order("name")).data ?? [],
  });
  const stock = useQuery({
    queryKey: ["insights", "andam-stock"],
    staleTime: 60_000, refetchInterval: REFRESH,
    queryFn: () => fetchAll<StockRow>((a, b) => supabase.from("andam_stock").select("item_id, location, quantity, work_id, client_id").gt("quantity", 0).order("id").range(a, b)),
  });
  const moves = useQuery({
    queryKey: ["insights", "andam-moves-week", weekAgo],
    staleTime: 60_000, refetchInterval: REFRESH,
    queryFn: () => fetchAll<MoveRow>((a, b) => supabase.from("andam_movements")
      .select("created_at, quantity, from_location, to_location, from_work_id, to_work_id, from_client_id, to_client_id")
      .gte("created_at", `${weekAgo}T00:00:00`).order("id").range(a, b)),
  });
  const structs = useQuery({
    queryKey: ["insights", "andam-structs"],
    staleTime: 60_000, refetchInterval: REFRESH,
    queryFn: () => fetchAll<StructRow>((a, b) => supabase.from("andam_structures")
      .select("id, status, assembled_at, order_code, location_desc, client_id, work_id").neq("status", "desmontado").order("id").range(a, b)),
  });
  const scaf = useQuery({
    queryKey: ["insights", "andam-prod-week", weekAgo],
    staleTime: 60_000, refetchInterval: REFRESH,
    queryFn: async () => {
      const rows = await fetchAll<{ operation: string; length_m: number | null; width_m: number | null; height_m: number | null; quantity: number | null; rdos: { report_date: string; responsible_name: string | null; client_id: string | null } | null }>((a, b) =>
        supabase.from("rdo_scaffolds").select("operation, length_m, width_m, height_m, quantity, rdos!inner(report_date, responsible_name, client_id)")
          .eq("operation", "montagem").gte("rdos.report_date", weekAgo).lte("rdos.report_date", today).order("id").range(a, b) as never);
      return rows.map((r) => ({ ...r, report_date: r.rdos?.report_date ?? "", responsible: r.rdos?.responsible_name ?? null, client_id: r.rdos?.client_id ?? null }));
    },
  });
  const reqs = useQuery({
    queryKey: ["insights", "andam-reqs"],
    staleTime: 60_000, refetchInterval: REFRESH,
    queryFn: async () => {
      const [list, roles] = await Promise.all([
        fetchAll<RequestRow & { client_id: string }>((a, b) => supabase.from("andam_requests").select("id, number, flow_stage, updated_at, user_id, client_id")
          .not("flow_stage", "in", "(encerrada,cancelada)").order("id").range(a, b)),
        supabase.from("andam_flow_roles").select("key, user_id"),
      ]);
      const ids: Record<string, string> = {};
      for (const r of roles.data ?? []) ids[r.key] = r.user_id;
      return { list, roles: ids };
    },
  });

  const names = useMemo(() => ({
    work: new Map(works.map((w) => [w.id, w.name])),
    client: new Map((allClients.data ?? []).map((c) => [c.id, c.name])),
  }), [works, allClients.data]);
  const places = useMemo(() => stockByPlace((stock.data ?? []).filter((s) => okClient(s.client_id)), moves.data ?? [], names),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stock.data, moves.data, names, allowed]);
  const standing = useMemo(() => oldestStanding((structs.data ?? []).filter((s) => okClient(s.client_id)), today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structs.data, today, allowed]);
  const prod = useMemo(() => weeklyProductivity((scaf.data ?? []).filter((r) => okClient(r.client_id)) as ScaffoldRow[], today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scaf.data, today, allowed]);
  const stages = useMemo(() => {
    const roles = reqs.data?.roles ?? {};
    const uid = user?.id;
    return requestsByStage((reqs.data?.list ?? []).filter((r) => okClient(r.client_id)), today,
      (actor, r) => !!uid && (actor === "solicitante" ? r.user_id === uid : roles[actor] === uid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqs.data, today, user?.id, allowed]);
  const totalPieces = places.reduce((s, p) => s + p.pieces, 0);
  const myPending = stages.reduce((s, x) => s + x.mine, 0);
  const openReqs = stages.reduce((s, x) => s + x.count, 0);

  /** Abre a subaba da página (na própria página troca a aba; de outra, vai pelo endereço #aba). */
  const goTab = (to: "/andaimes/acompanhamento", tab: string) => {
    const st = pageTabsStore.get();
    if (pathname === to && st.setValue && st.items.some((x) => x.value === tab)) { st.setValue(tab); return; }
    navigate({ to, hash: tab });
  };
  const openPlace = (p: (typeof places)[number]) => {
    if (onPlace) { onPlace({ location: p.location, workId: p.workId, clientId: p.clientId }); return; }
    navigate({ to: "/andaimes/estoque", search: { local: p.location, ...(p.workId ? { obra: p.workId } : {}), ...(p.clientId ? { cliente: p.clientId } : {}) } });
  };
  const openStructure = (sid: string) => (onStructure ? onStructure(sid) : navigate({ to: "/andaimes/acompanhamento", search: { andaime: sid } }));
  const openStage = (key: string) => (onStage ? onStage(key) : navigate({ to: "/andaimes/solicitacoes", search: { etapa: key } }));

  return (
    <InsightStrip id={`andaimes-${id}`} summary={`${pieces(totalPieces)} peças · ${standing.length ? `mais antigo montado há ${standing[0]!.days} dias` : "nenhum montado"} · ${openReqs} solicitações em andamento`}>
      <InsightCard title="Estoque por local" icon={<Boxes />} loading={stock.isLoading} error={stock.isError}
        hint="Peças em estoque por local (Pátio, Canteiro do cliente, obras, trânsito, manutenção…), itens distintos e participação no total. Seta = transferências da semana (entrada ↙ / saída ↗). O peso não aparece porque o cadastro de itens não tem peso. Clique para ver o estoque do local.">
        <BigNumber label={`peças em ${places.length} ${places.length === 1 ? "local" : "locais"}`}><CountUp value={totalPieces} /></BigNumber>
        <div className="space-y-1">
          {places.slice(0, 5).map((p) => (
            <InsightRow key={p.key} className="flex-col items-stretch gap-0.5" onClick={() => openPlace(p)}
              title={`${p.label}: ${pieces(p.pieces)} peças, ${p.items} itens (${Math.round(p.share * 100)}%)${p.movedIn || p.movedOut ? `\nSemana: +${pieces(p.movedIn)} entrada, −${pieces(p.movedOut)} saída` : ""}`}>
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{p.label}</span>
                {p.movedIn > 0 && <ArrowDownLeft className="h-3 w-3 shrink-0 text-success" aria-label="Recebeu na semana" />}
                {p.movedOut > 0 && <ArrowUpRight className="h-3 w-3 shrink-0 text-orange-600 dark:text-orange-400" aria-label="Enviou na semana" />}
                <span className="shrink-0 tabular-nums text-muted-foreground">{pieces(p.pieces)}</span>
              </div>
              <Bar value={p.share} />
            </InsightRow>
          ))}
          {places.length > 5 && <div className="text-[11px] text-muted-foreground">+{places.length - 5} locais</div>}
        </div>
      </InsightCard>

      <InsightCard title="Montados há mais tempo" icon={<Construction />} loading={structs.isLoading} error={structs.isError}
        tone={standing[0] && standing[0].days > 90 ? "warn" : "default"}
        hint="Andaimes do Acompanhamento ainda de pé (não desmontados), pelos dias desde a data de montagem. Clique para abrir o andaime.">
        {standing.length ? (
          <div className="space-y-1">
            {standing.map((s) => (
              <InsightRow key={s.row.id} onClick={() => openStructure(s.row.id)}
                title={`${s.row.order_code || "Sem ordem"} · ${names.client.get(s.row.client_id) ?? ""} · ${s.row.work_id ? names.work.get(s.row.work_id) ?? "" : "Canteiro"}${s.row.location_desc ? ` · ${s.row.location_desc}` : ""}\nMontado em ${shortBR(s.row.assembled_at!)}`}>
                <span className="min-w-0 flex-1 truncate">{s.row.order_code || s.row.location_desc || "Sem ordem"}<span className="text-muted-foreground"> · {names.client.get(s.row.client_id) ?? ""}</span></span>
                <b className={cn("shrink-0 tabular-nums", s.days > 90 && "text-orange-600 dark:text-orange-400")}>{s.days} d</b>
              </InsightRow>
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">Nenhum andaime montado no Acompanhamento.</p>}
      </InsightCard>

      <InsightCard title="Produtividade · 7 dias" icon={<TrendingUp />} loading={scaf.isLoading} error={scaf.isError}
        onClick={() => goTab("/andaimes/acompanhamento", "produtividade")}
        hint="m³ montados nos RDOs dos últimos 7 dias (comprimento × largura × altura × quantidade das linhas de Montagem), por encarregado (responsável do RDO), com a linha dia a dia. Clique para abrir a Produtividade.">
        <div className="flex items-end justify-between gap-2">
          <BigNumber label="montados"><CountUp value={m3(prod.total)} /></BigNumber>
          <Sparkline values={prod.series} title={prod.days.map((d, i) => `${shortBR(d)}: ${m3(prod.series[i]!)}`).join("\n")} />
        </div>
        <div className="space-y-0.5">
          {prod.teams.slice(0, 4).map((t) => (
            <div key={t.name} className="flex items-center gap-2 text-xs" title={t.series.map((v, i) => `${shortBR(prod.days[i]!)}: ${m3(v)}`).join("\n")}>
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <Sparkline values={t.series} width={52} height={16} className="text-muted-foreground" />
              <span className="w-16 shrink-0 text-right tabular-nums">{m3(t.total)}</span>
            </div>
          ))}
          {!prod.teams.length && <p className="text-xs text-muted-foreground">Nenhuma montagem lançada nos RDOs da semana.</p>}
        </div>
      </InsightCard>

      <InsightCard title="Solicitações por etapa" icon={<GitBranch />} loading={reqs.isLoading} error={reqs.isError}
        tone={myPending ? "alert" : "default"} pulse={myPending > 0}
        hint="Solicitações em andamento em cada etapa do fluxo e há quantos dias a mais antiga está parada (última atualização). A etapa que espera ação sua pulsa. Clique para filtrar as Solicitações pela etapa.">
        <BigNumber label={myPending ? `em andamento · ${myPending} esperando você` : "em andamento"}><CountUp value={openReqs} /></BigNumber>
        <div className="space-y-0.5">
          {stages.filter((s) => s.count).map((s) => (
            <InsightRow key={s.key} onClick={() => openStage(s.key)} className={cn(stage === s.key && "bg-primary/10")}
              title={`${s.label}: ${s.count}${s.oldestDays != null ? ` · mais antiga parada há ${s.oldestDays} dias` : ""}${s.mine ? ` · ${s.mine} com você` : ""}`}>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", s.mine ? "insight-pulse bg-destructive" : "bg-primary/60")} />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              {s.oldestDays != null && s.oldestDays > 0 && <span className="shrink-0 text-muted-foreground">{s.oldestDays}d</span>}
              <b className="w-6 shrink-0 text-right tabular-nums">{s.count}</b>
            </InsightRow>
          ))}
          {!openReqs && <p className="text-xs text-muted-foreground">Nenhuma solicitação em andamento.</p>}
        </div>
      </InsightCard>
    </InsightStrip>
  );
}

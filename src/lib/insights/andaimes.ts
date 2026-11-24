/**
 * Regras dos blocos vivos de Andaimes: mapa do estoque por local, montados há mais tempo, produtividade da semana
 * (m³ montados por encarregado, rdo_scaffolds) e solicitações por etapa do fluxo (andam_requests.flow_stage).
 */
import { FLOW, locLabel, type FlowActor } from "@/lib/andaimes";
import { addDaysIso, daysBetween } from "@/lib/insights/dates";

export type StockRow = { item_id: string; location: string; quantity: number; work_id: string | null; client_id: string | null };
export type MoveRow = {
  created_at: string; quantity: number; from_location: string | null; to_location: string | null;
  from_work_id: string | null; to_work_id: string | null; from_client_id: string | null; to_client_id: string | null;
};

/** Chave do local: obra (serviço), Canteiro do cliente (obra sem serviço) ou local fixo (central, trânsito…). */
export const placeKey = (location: string | null, workId: string | null, clientId: string | null) =>
  location === "obra" ? (workId ? `obra|${workId}` : `canteiro|${clientId ?? ""}`) : `loc|${location ?? ""}`;

export type Place = {
  key: string; label: string; location: string; workId: string | null; clientId: string | null;
  pieces: number; items: number; share: number; movedIn: number; movedOut: number;
};

/** Peças e itens distintos por local, participação no total e transferências recebidas/enviadas no período dos movimentos. */
export function stockByPlace(
  stock: StockRow[], moves: MoveRow[],
  names: { work: ReadonlyMap<string, string>; client: ReadonlyMap<string, string> },
): Place[] {
  const m = new Map<string, Place & { itemSet: Set<string> }>();
  const get = (location: string, workId: string | null, clientId: string | null) => {
    const key = placeKey(location, workId, clientId);
    let p = m.get(key);
    if (!p) {
      const label = location === "obra"
        ? (workId ? names.work.get(workId) ?? "Obra" : `Canteiro${clientId && names.client.get(clientId) ? ` · ${names.client.get(clientId)}` : ""}`)
        : locLabel(location);
      p = { key, label, location, workId: location === "obra" ? workId : null, clientId: location === "obra" ? clientId : null, pieces: 0, items: 0, share: 0, movedIn: 0, movedOut: 0, itemSet: new Set() };
      m.set(key, p);
    }
    return p;
  };
  for (const s of stock) {
    const q = Number(s.quantity) || 0;
    if (q <= 0) continue;
    const p = get(s.location, s.work_id, s.client_id);
    p.pieces += q;
    p.itemSet.add(s.item_id);
  }
  for (const mv of moves) {
    const q = Math.abs(Number(mv.quantity) || 0);
    const from = mv.from_location ? placeKey(mv.from_location, mv.from_work_id, mv.from_client_id) : null;
    const to = mv.to_location ? placeKey(mv.to_location, mv.to_work_id, mv.to_client_id) : null;
    if (from === to) continue;
    if (to && m.has(to)) m.get(to)!.movedIn += q;
    if (from && m.has(from)) m.get(from)!.movedOut += q;
  }
  const total = [...m.values()].reduce((s, p) => s + p.pieces, 0);
  return [...m.values()]
    .filter((p) => p.pieces > 0)
    .map(({ itemSet, ...p }) => ({ ...p, items: itemSet.size, share: total ? p.pieces / total : 0 }))
    .sort((a, b) => b.pieces - a.pieces || a.label.localeCompare(b.label, "pt-BR"));
}

export type StructRow = { id: string; status: string; assembled_at: string | null; order_code: string | null; location_desc: string | null; client_id: string; work_id: string | null };

/** Andaimes ainda de pé (não desmontados) com data de montagem, do mais antigo para o mais novo. */
export function oldestStanding(rows: StructRow[], today: string, n = 5) {
  return rows
    .filter((r) => r.status !== "desmontado" && r.assembled_at)
    .map((r) => ({ row: r, days: Math.max(0, daysBetween(r.assembled_at!, today)) }))
    .sort((a, b) => b.days - a.days || (a.row.order_code ?? "").localeCompare(b.row.order_code ?? ""))
    .slice(0, n);
}

export type ScaffoldRow = { operation: string; length_m: number | null; width_m: number | null; height_m: number | null; quantity: number | null; report_date: string; responsible: string | null };

/** Volume (m³) de uma linha de andaime do RDO = C × L × A × quantidade (mesma conta da Produtividade). */
export const scaffoldVolume = (r: Pick<ScaffoldRow, "length_m" | "width_m" | "height_m" | "quantity">) =>
  Number(r.length_m ?? 0) * Number(r.width_m ?? 0) * Number(r.height_m ?? 0) * Number(r.quantity ?? 1);

/** m³ montados nos últimos 7 dias (hoje incluído) por encarregado (responsável do RDO), com a série diária. */
export function weeklyProductivity(rows: ScaffoldRow[], today: string) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(today, i - 6));
  const idx = new Map(days.map((d, i) => [d, i]));
  const by = new Map<string, number[]>();
  const all = days.map(() => 0);
  for (const r of rows) {
    if (r.operation !== "montagem") continue;
    const i = idx.get(r.report_date);
    if (i == null) continue;
    const v = scaffoldVolume(r);
    if (!(v > 0)) continue;
    const who = (r.responsible ?? "").trim() || "Sem responsável";
    const series = by.get(who) ?? days.map(() => 0);
    series[i]! += v;
    by.set(who, series);
    all[i]! += v;
  }
  const teams = [...by].map(([name, series]) => ({ name, series, total: series.reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));
  return { days, total: all.reduce((s, v) => s + v, 0), series: all, teams };
}

export type RequestRow = { id: string; number: number; flow_stage: string; updated_at: string; user_id: string | null };
export type StageCount = { key: string; label: string; actor: FlowActor; count: number; mine: number; oldestDays: number | null };

/** Solicitações em andamento por etapa do fluxo; "mine" = esperando ação de quem está vendo (coordenador, pátio ou solicitante). */
export function requestsByStage(rows: RequestRow[], today: string, actorOf: (actor: FlowActor, r: RequestRow) => boolean): StageCount[] {
  return FLOW.filter((s): s is typeof s & { actor: FlowActor } => !!s.actor).map((s) => {
    const list = rows.filter((r) => r.flow_stage === s.key);
    const oldest = list.reduce<number | null>((mx, r) => { const d = daysBetween(r.updated_at, today); return mx == null || d > mx ? d : mx; }, null);
    return { key: s.key, label: s.label, actor: s.actor, count: list.length, mine: list.filter((r) => actorOf(s.actor, r)).length, oldestDays: oldest };
  });
}

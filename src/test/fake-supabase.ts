/**
 * Cliente Supabase em memória para testes do motor de Resultados/Financeiro.
 * Suporta o subconjunto usado pelos loaders: select com relações embutidas,
 * eq, in, gte, lte, or, order, range, maybeSingle e rpc. Conta as requisições
 * para medir quantas idas ao banco cada tela faz.
 */
type Row = Record<string, any>;
export type FakeDb = Record<string, Row[]>;

/** Relação embutida → coluna estrangeira na tabela de origem. */
const EMBED_FK: Record<string, Record<string, string>> = {
  daily_allocations: { daily_schedules: "schedule_id" },
  daily_status_entries: { daily_schedules: "schedule_id" },
  rdo_workforce: { collaborators: "collaborator_id", rdos: "rdo_id" },
  vehicle_schedules: { vehicles: "vehicle_id", collaborators: "driver_id" },
  works: { clients: "client_id" },
};

function splitTop(s: string) {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const norm = (v: any) => (v === null || v === undefined ? v : typeof v === "boolean" ? String(v) : String(v));
function cmp(op: string, a: any, b: string) {
  if (op === "eq") return norm(a) === b;
  if (op === "in") return b.slice(1, -1).split(",").includes(norm(a));
  if (a === null || a === undefined) return false;
  if (op === "gte") return String(a) >= b;
  if (op === "lte") return String(a) <= b;
  if (op === "gt") return String(a) > b;
  if (op === "lt") return String(a) < b;
  throw new Error(`op ${op}`);
}
function orFilter(expr: string): (r: Row) => boolean {
  const parts = splitTop(expr).map((p) => {
    if (p.startsWith("and(")) {
      const inner = splitTop(p.slice(4, -1)).map((q) => orFilter(q));
      return (r: Row) => inner.every((f) => f(r));
    }
    const [col, op, ...rest] = p.split(".");
    const val = rest.join(".");
    return (r: Row) => cmp(op!, r[col!], val);
  });
  return (r) => parts.some((f) => f(r));
}

export class FakeSupabase {
  requests: { table: string; kind: string }[] = [];
  rpcCalls: { fn: string; args: any }[] = [];
  constructor(public db: FakeDb) {}
  private byId = new Map<string, Map<string, Row>>();
  setDb(db: FakeDb) { this.db = db; this.byId.clear(); this.requests = []; this.rpcCalls = []; }
  private index(table: string) {
    let m = this.byId.get(table);
    if (!m) { m = new Map((this.db[table] ?? []).map((r) => [r["id"], r])); this.byId.set(table, m); }
    return m;
  }
  project(table: string, row: Row, cols: string): Row {
    const out: Row = {};
    for (const c of splitTop(cols)) {
      const m = c.match(/^(\w+)\((.*)\)$/);
      if (m) {
        const rel = m[1]!;
        const fk = EMBED_FK[table]?.[rel];
        if (!fk) throw new Error(`embed ${table}.${rel}`);
        const target = row[fk] ? this.index(rel).get(row[fk]) : undefined;
        out[rel] = target ? this.project(rel, target, m[2]!) : null;
      } else if (c === "*") {
        for (const [k, v] of Object.entries(row)) if (!(k in out) && !(EMBED_FK[table]?.[k])) out[k] = v;
      } else {
        out[c] = row[c] ?? null;
      }
    }
    return out;
  }
  from(table: string) { return new Query(this, table); }
  async rpc(fn: string, args: any) {
    this.requests.push({ table: `rpc:${fn}`, kind: "rpc" });
    this.rpcCalls.push({ fn, args });
    return { data: 0, error: null };
  }
}

class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private cols = "*";
  private rng: [number, number] | null = null;
  private single = false;
  constructor(private c: FakeSupabase, private table: string) {}
  select(cols: string) { this.cols = cols; return this; }
  eq(col: string, v: any) { const s = norm(v); this.filters.push((r) => norm(r[col]) === s); return this; }
  in(col: string, vs: any[]) { const s = new Set(vs.map(norm)); this.filters.push((r) => s.has(norm(r[col]))); return this; }
  gte(col: string, v: any) { this.filters.push((r) => cmp("gte", r[col], String(v))); return this; }
  lte(col: string, v: any) { this.filters.push((r) => cmp("lte", r[col], String(v))); return this; }
  or(expr: string) { this.filters.push(orFilter(expr)); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending !== false }); return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  private run() {
    this.c.requests.push({ table: this.table, kind: "select" });
    let rows = (this.c.db[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length) {
      rows = [...rows].sort((x, y) => {
        for (const { col, asc } of this.orders) {
          const a = x[col], b = y[col];
          if (a === b) continue;
          if (a === null || a === undefined) return 1;
          if (b === null || b === undefined) return -1;
          return (a < b ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    const data = rows.map((r) => this.c.project(this.table, r, this.cols));
    if (this.single) return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
  then<T>(res: (v: { data: any; error: null }) => T, rej?: (e: unknown) => T) {
    try { return Promise.resolve(this.run()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); }
  }
}

import { useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TableHead } from "@/components/ui/table";

/**
 * Filtro de coluna como no Excel: cada coluna tem a lista dos valores que aparecem nela, com busca,
 * marcar/desmarcar e ordenar. Sem filtro = todos marcados. Linha com vários valores (ex.: rateio em dois
 * clientes) passa se qualquer um deles estiver marcado.
 */
export type ColumnDef<T> = {
  key: string;
  label: string;
  align?: "right";
  /** Valores da linha nesta coluna (como aparecem na tela). Vazio vira "(vazias)". */
  values: (row: T) => string[];
  /** Valor para ordenar (número ou texto). */
  sort?: (row: T) => number | string | null;
};
export type ColumnFilters = Record<string, Set<string> | undefined>;
export type ColumnSort = { key: string; dir: "asc" | "desc" } | null;
export const EMPTY_VALUE = "(vazias)";

const cellValues = <T,>(c: ColumnDef<T>, row: T) => {
  const v = c.values(row).map((x) => (x ?? "").trim()).filter(Boolean);
  return v.length ? v : [EMPTY_VALUE];
};

/** Aplica os filtros e a ordenação das colunas. */
export function applyColumnFilters<T>(rows: T[], columns: ColumnDef<T>[], filters: ColumnFilters, sort: ColumnSort): T[] {
  const active = columns.filter((c) => filters[c.key]);
  let out = active.length ? rows.filter((r) => active.every((c) => cellValues(c, r).some((v) => filters[c.key]!.has(v)))) : rows;
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  if (col && sort) {
    const val = (r: T) => (col.sort ? col.sort(r) : cellValues(col, r)[0]!);
    out = [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR", { numeric: true });
      return sort.dir === "asc" ? d : -d;
    });
  }
  return out;
}

/** Cabeçalho da coluna com o botão de filtro. `rows` = linhas sem o filtro desta coluna (como no Excel). */
export function FilterHead<T>({ column, rows, filters, setFilters, sort, setSort }: {
  column: ColumnDef<T>; rows: T[]; filters: ColumnFilters; setFilters: (f: ColumnFilters) => void; sort: ColumnSort; setSort: (s: ColumnSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const all = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const v of cellValues(column, r)) s.add(v);
    return [...s].sort((a, b) => (a === EMPTY_VALUE ? 1 : b === EMPTY_VALUE ? -1 : a.localeCompare(b, "pt-BR", { numeric: true })));
  }, [rows, column]);
  const current = filters[column.key];
  const list = all.filter((v) => v.toLowerCase().includes(q.trim().toLowerCase()));
  const allChecked = list.length > 0 && list.every((v) => draft.has(v));
  const sorted = sort?.key === column.key ? sort.dir : null;
  const onOpen = (o: boolean) => { setOpen(o); if (o) { setQ(""); setDraft(new Set(current ?? all)); } };
  const apply = () => {
    const next = { ...filters };
    if (draft.size === 0 || all.every((v) => draft.has(v))) delete next[column.key];
    else next[column.key] = new Set(draft);
    setFilters(next);
    setOpen(false);
  };
  return (
    <TableHead className={column.align === "right" ? "text-right" : undefined}>
      <div className={`inline-flex items-center gap-0.5 ${column.align === "right" ? "flex-row-reverse" : ""}`}>
        <span>{column.label}</span>
        <Popover open={open} onOpenChange={onOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={`h-5 w-5 ${current || sorted ? "text-primary" : "text-muted-foreground"}`} aria-label={`Filtrar ${column.label}`}>
              {sorted === "asc" ? <ArrowDownAZ className="h-3.5 w-3.5" /> : sorted === "desc" ? <ArrowUpAZ className="h-3.5 w-3.5" /> : <Filter className={`h-3 w-3 ${current ? "fill-current" : ""}`} />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2 text-sm font-normal" align="start">
            <div className="mb-2 flex gap-1">
              <Button variant={sorted === "asc" ? "secondary" : "ghost"} size="sm" className="h-7 flex-1 justify-start px-2 text-xs" onClick={() => { setSort(sorted === "asc" ? null : { key: column.key, dir: "asc" }); setOpen(false); }}><ArrowDownAZ className="h-3.5 w-3.5" /> Crescente</Button>
              <Button variant={sorted === "desc" ? "secondary" : "ghost"} size="sm" className="h-7 flex-1 justify-start px-2 text-xs" onClick={() => { setSort(sorted === "desc" ? null : { key: column.key, dir: "desc" }); setOpen(false); }}><ArrowUpAZ className="h-3.5 w-3.5" /> Decrescente</Button>
            </div>
            <Input className="mb-2 h-8 text-xs" placeholder="Pesquisar" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-2 border-b border-border px-1 pb-1.5 text-xs font-medium">
              <Checkbox checked={allChecked} onCheckedChange={(c) => setDraft((d) => { const n = new Set(d); list.forEach((v) => (c ? n.add(v) : n.delete(v))); return n; })} />
              (Selecionar tudo{q ? " o que aparece" : ""})
            </label>
            <div className="max-h-56 overflow-y-auto py-1">
              {list.map((v) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent">
                  <Checkbox checked={draft.has(v)} onCheckedChange={(c) => setDraft((d) => { const n = new Set(d); if (c) n.add(v); else n.delete(v); return n; })} />
                  <span className="truncate">{v}</span>
                </label>
              ))}
              {!list.length && <p className="px-1 py-2 text-xs text-muted-foreground">Nada encontrado.</p>}
            </div>
            <div className="mt-1 flex justify-end gap-1 border-t border-border pt-2">
              {current && <Button variant="ghost" size="sm" className="mr-auto h-7 text-xs" onClick={() => { const n = { ...filters }; delete n[column.key]; setFilters(n); setOpen(false); }}>Limpar filtro</Button>}
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button size="sm" className="h-7 text-xs" disabled={!draft.size} onClick={apply}>OK</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TableHead>
  );
}

/** Linhas para a lista de valores da coluna `key`: as que passam em todos os outros filtros (como no Excel). */
export function rowsForColumn<T>(rows: T[], columns: ColumnDef<T>[], filters: ColumnFilters, key: string): T[] {
  const others: ColumnFilters = { ...filters };
  delete others[key];
  return applyColumnFilters(rows, columns, others, null);
}

/**
 * Blocos vivos: faixa de indicadores dinâmicos e clicáveis no topo das páginas.
 * InsightStrip = grade responsiva que pode ser recolhida (lembrada no navegador por página);
 * InsightCard = bloco com título, número de destaque, gráfico leve e clique que leva à lista filtrada.
 * Alerta só "pulsa" quando exige ação (pulse), e respeita prefers-reduced-motion (styles.css).
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const storageKey = (id: string) => `insights-collapsed:${id}`;

function readCollapsed(id: string) {
  try { return window.localStorage.getItem(storageKey(id)) === "1"; } catch { return false; }
}
function writeCollapsed(id: string, v: boolean) {
  try { if (v) window.localStorage.setItem(storageKey(id), "1"); else window.localStorage.removeItem(storageKey(id)); } catch { /* sem armazenamento */ }
}

export function InsightStrip({ id, title = "Painel", summary, children, className }: {
  /** Chave da página (lembra se está recolhida). */
  id: string;
  title?: string;
  /** Resumo curto mostrado quando a faixa está recolhida. */
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(readCollapsed(id)); }, [id]);
  const toggle = () => setCollapsed((c) => { writeCollapsed(id, !c); return !c; });
  return (
    <section className={cn("space-y-2", className)} aria-label={title}>
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {collapsed && summary && <div className="min-w-0 truncate text-xs text-muted-foreground">{summary}</div>}
        <button type="button" onClick={toggle} aria-expanded={!collapsed}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          {collapsed ? <><ChevronDown className="h-3.5 w-3.5" /> Mostrar</> : <><ChevronUp className="h-3.5 w-3.5" /> Recolher</>}
        </button>
      </div>
      {!collapsed && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>}
    </section>
  );
}

export type InsightTone = "default" | "ok" | "warn" | "alert" | "info";

const TONE_BORDER: Record<InsightTone, string> = {
  default: "border-l-border",
  ok: "border-l-success",
  warn: "border-l-warning",
  alert: "border-l-destructive",
  info: "border-l-info",
};

export function InsightCard({ title, icon, tone = "default", pulse, hint, onClick, children, className, loading, error }: {
  title: string;
  icon?: ReactNode;
  tone?: InsightTone;
  /** Pulsa discretamente: só quando exige ação. */
  pulse?: boolean;
  /** Explica a conta (aparece ao passar o mouse). */
  hint?: string;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
  loading?: boolean;
  error?: boolean;
}) {
  const onKey = (e: KeyboardEvent) => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } };
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKey}
      title={hint}
      className={cn(
        "insight-card relative flex min-h-[128px] min-w-0 flex-col gap-2 rounded-lg border border-l-4 bg-card p-3 text-left shadow-sm",
        TONE_BORDER[tone],
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon && <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
        <span className="truncate">{title}</span>
        {pulse && <span className="insight-pulse ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="Exige ação" />}
      </div>
      {loading ? (
        <div className="space-y-2" aria-busy>
          <div className="h-6 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
        </div>
      ) : error ? (
        <p className="text-xs text-muted-foreground">Não foi possível ler os dados.</p>
      ) : children}
    </div>
  );
}

/** Número de destaque + legenda curta. */
export function BigNumber({ children, label, className }: { children: ReactNode; label?: ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={cn("font-display text-2xl font-semibold tabular-nums leading-none", className)}>{children}</span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

/** Linha clicável dentro de um bloco (não dispara o clique do bloco). */
export function InsightRow({ children, onClick, title, className }: { children: ReactNode; onClick?: () => void; title?: string; className?: string }) {
  if (!onClick) return <div className={cn("flex min-w-0 items-center gap-2 text-xs", className)} title={title}>{children}</div>;
  return (
    <button type="button" title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn("flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted", className)}>
      {children}
    </button>
  );
}

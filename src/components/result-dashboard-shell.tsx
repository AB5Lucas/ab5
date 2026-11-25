import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";

export function ResultCard({ title, dark, className, onEdit, children }: {
  title: string; dark?: boolean; className?: string; onEdit?: () => void; children: ReactNode;
}) {
  return <section className={cn("ov-card result-card flex min-w-0 flex-col rounded-2xl border p-4", dark ? "border-transparent bg-foreground text-background" : "border-border bg-card", className)}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className={cn("text-xs font-medium", dark ? "text-background/70" : "text-muted-foreground")}>{title}</h2>
      {onEdit && <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-inherit" title={`Editar ${title.toLowerCase()}`} aria-label={`Editar ${title.toLowerCase()}`} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>}
    </div>
    <div className="min-h-0 flex-1">{children}</div>
  </section>;
}

export function ResultChartSkeleton() {
  return <div aria-label="Carregando gráfico" className="result-skeleton flex h-full min-h-32 items-end gap-3 overflow-hidden rounded-lg bg-muted/40 p-5">
    {[35, 65, 45, 80, 55, 90, 70, 50].map((h, i) => <span key={i} className={`flex-1 rounded-sm bg-foreground/10 result-skeleton-bar-${h}`} />)}
  </div>;
}

export function ResultDashboardSkeleton() {
  return <DashboardSkeleton label="Carregando resultados" />;
}
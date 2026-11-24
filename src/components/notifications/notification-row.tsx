import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, Bell, Check, Clock, ShoppingCart, Undo2 } from "lucide-react";
import { formatBrasilia } from "@/lib/notifications";
import type { AppNotification } from "@/hooks/use-notifications";

const MODULE_LABEL: Record<string, string> = { compras: "Compras", sistema: "Sistema" };

function iconFor(n: AppNotification) {
  if (n.kind === "sc_prazo_atrasado") return { Icon: AlertTriangle, cls: "bg-destructive/15 text-destructive" };
  if (n.kind === "sc_prazo_urgente") return { Icon: Clock, cls: "bg-destructive/10 text-destructive" };
  if (n.kind === "sc_prazo_antecedencia") return { Icon: Clock, cls: "bg-warning/20 text-orange-600 dark:text-orange-400" };
  if (n.kind === "sc_devolvida" || n.kind === "sc_validacao_devolvida") return { Icon: Undo2, cls: "bg-warning/20 text-orange-600 dark:text-orange-400" };
  if (n.module === "compras") return { Icon: ShoppingCart, cls: "bg-primary/10 text-primary" };
  return { Icon: Bell, cls: "bg-muted text-muted-foreground" };
}

/** Linha de notificação: clicar marca como lida e abre o link (ex.: a SC). */
export function NotificationRow({ n, onRead, onOpen, compact }: { n: AppNotification; onRead: (id: string) => void; onOpen?: () => void; compact?: boolean }) {
  const router = useRouter();
  const { Icon, cls } = iconFor(n);
  const unread = !n.read_at;
  const open = () => {
    if (unread) onRead(n.id);
    onOpen?.();
    if (n.link) router.history.push(n.link);
  };
  return (
    <div className={`group flex items-start gap-3 px-3 py-2 ${unread ? "bg-primary/[0.04]" : ""} hover:bg-accent`}>
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-start gap-3 text-left">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${cls}`}><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span>{MODULE_LABEL[n.module] ?? n.module}</span>
            {n.ref && <span className="font-medium text-foreground/80">{n.ref}</span>}
            <span>{formatBrasilia(n.created_at)}</span>
          </span>
          <span className={`block text-sm ${unread ? "font-semibold" : "font-medium text-foreground/85"}`}>{n.title}</span>
          {n.body && <span className={`block text-xs text-muted-foreground ${compact ? "line-clamp-2" : ""}`}>{n.body}</span>}
        </span>
      </button>
      {unread ? (
        <button type="button" onClick={() => onRead(n.id)} title="Marcar como lida" aria-label="Marcar como lida"
          className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground">
          <span className="h-2 w-2 rounded-full bg-primary group-hover:hidden" />
          <Check className="hidden h-3.5 w-3.5 group-hover:block" />
        </button>
      ) : <span className="w-6 shrink-0" />}
    </div>
  );
}

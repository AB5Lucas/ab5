import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationRow } from "@/components/notifications/notification-row";
import { NotificationPrefsForm } from "@/components/notifications/notification-prefs";
import { useMarkRead, useNotificationPage } from "@/hooks/use-notifications";

type Aba = "notificacoes" | "preferencias";
const PAGE_SIZE = 30;

export const Route = createFileRoute("/_authenticated/notificacoes")({
  validateSearch: (s: Record<string, unknown>): { aba?: Aba } => (s["aba"] === "preferencias" ? { aba: "preferencias" } : {}),
  head: () => ({ meta: [{ title: "Notificações | Programação Operacional" }, { name: "description", content: "Histórico de notificações e preferências de envio." }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { aba } = Route.useSearch();
  const navigate = useNavigate({ from: "/notificacoes" });
  const tab: Aba = aba ?? "notificacoes";
  return (
    <div className="space-y-4">
      <PageHeader title="Notificações" description="Avisos pessoais das suas pendências (Compras) e como você quer recebê-los." />
      <Tabs value={tab} onValueChange={(v) => navigate({ search: v === "preferencias" ? { aba: "preferencias" } : {}, replace: true })}>
        <TabsList>
          <TabsTrigger value="notificacoes">Notificações</TabsTrigger>
          <TabsTrigger value="preferencias">Preferências</TabsTrigger>
        </TabsList>
        <TabsContent value="notificacoes" className="mt-4"><History /></TabsContent>
        <TabsContent value="preferencias" className="mt-4"><NotificationPrefsForm /></TabsContent>
      </Tabs>
    </div>
  );
}

function History() {
  const [page, setPage] = useState(0);
  const [show, setShow] = useState<"todas" | "nao-lidas">("todas");
  const q = useNotificationPage(page, PAGE_SIZE, show === "nao-lidas");
  const markRead = useMarkRead();
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = q.data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Mostrar</Label>
          <Select value={show} onValueChange={(v) => { setShow(v as typeof show); setPage(0); }}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="nao-lidas">Não lidas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => markRead.mutate("all")} disabled={markRead.isPending}><CheckCheck className="h-4 w-4" /> Marcar todas como lidas</Button>
        <span className="ml-auto text-sm text-muted-foreground">{total} notificação(ões)</span>
      </div>
      <div className="panel divide-y divide-border overflow-hidden">
        {!items.length ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{q.isLoading ? "Carregando…" : "Nenhuma notificação."}</p>
        ) : items.map((n) => <NotificationRow key={n.id} n={n} onRead={(id) => markRead.mutate([id])} />)}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span className="text-muted-foreground">Página {page + 1} de {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { RdoEditor, workLabel } from "@/components/rdo-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentUser } from "@/hooks/use-auth";
import { todayISO, formatDateBR } from "@/lib/scheduling";
import { RDO_STATUS_LABEL } from "@/lib/rdo";
import { exportRdoPdf } from "@/lib/rdo-pdf";

export const Route = createFileRoute("/_authenticated/externo/relatorio-diario")({
  head: () => ({
    meta: [
      { title: "Relatório Diário de Obras — RDO | AB5 Hub" },
      { name: "description", content: "Preencha o RDO pelo celular: efetivo da programação, horários, serviços, fotos e assinaturas." },
      { property: "og:title", content: "Relatório Diário de Obras — RDO | AB5 Hub" },
      { property: "og:description", content: "RDO integrado à programação de obras da AB5." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RdoPage,
});

function RdoPage() {
  const { user, canWrite } = useCurrentUser();
  const [tab, setTab] = useState("fill");
  const [workId, setWorkId] = useState<string>("");
  const [date, setDate] = useState(todayISO());

  const works = useQuery({
    queryKey: ["rdo-works", user?.id, canWrite],
    enabled: !!user?.id,
    queryFn: async () => {
      const sel = "id, name, client_id, entry_time, exit_time, exit_time_weekend, active, clients(name)";
      if (canWrite) {
        const { data } = await supabase.from("works").select(sel).eq("active", true);
        return data ?? [];
      }
      // Cliente atribuído libera todos os serviços ativos desse cliente
      const { data: links } = await supabase.from("foreman_works").select("works(client_id)").eq("user_id", user!.id);
      const clientIds = [...new Set((links ?? []).map((l: any) => l.works?.client_id).filter(Boolean))] as string[];
      if (!clientIds.length) return [];
      const { data } = await supabase.from("works").select(sel).in("client_id", clientIds).eq("active", true);
      return data ?? [];
    },
    select: (d) => d.slice().sort((a, b) => workLabel(a).localeCompare(workLabel(b), "pt-BR")),
  });

  const pref = useQuery({
    queryKey: ["rdo-pref", user?.id],
    enabled: !!user?.id,
    queryFn: async () => (await supabase.from("rdo_user_prefs").select("last_work_id").eq("user_id", user!.id).maybeSingle()).data,
  });

  useEffect(() => {
    if (workId || !works.data) return;
    const last = pref.data?.last_work_id;
    if (last && works.data.some((w) => w.id === last)) setWorkId(last);
    else if (works.data.length === 1) setWorkId(works.data[0]!.id);
  }, [works.data, pref.data, workId]);

  function chooseWork(id: string) {
    setWorkId(id);
    if (user?.id) void supabase.from("rdo_user_prefs").upsert({ user_id: user.id, last_work_id: id });
  }

  const work = works.data?.find((w) => w.id === workId);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Relatório Diário de Obras — RDO" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="fill">Preencher</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="fill" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div>
              <Label>Obra</Label>
              <Select value={workId} onValueChange={chooseWork}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder={works.data?.length === 0 ? "Nenhuma obra vinculada a você" : "Selecione a obra"} />
                </SelectTrigger>
                <SelectContent>
                  {(works.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>{workLabel(w)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data</Label>
              <Input type="date" className="h-12" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          </div>
          {work ? <RdoEditor key={`${work.id}-${date}`} work={work} date={date} /> : (
            <p className="panel p-6 text-center text-sm text-muted-foreground">Selecione a obra para começar.</p>
          )}
        </TabsContent>
        <TabsContent value="history">
          <RdoHistory
            onOpen={(w, d) => { chooseWork(w); setDate(d); setTab("fill"); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RdoHistory({ onOpen }: { onOpen: (workId: string, date: string) => void }) {
  const { isAdmin } = useCurrentUser();
  const [f, setF] = useState({ text: "", from: "", to: "", status: "all" });
  const list = useQuery({
    queryKey: ["rdo-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rdos")
        .select("id, number, work_id, report_date, status, responsible_name, works(name, clients(name)), rdo_workforce(present), rdo_media(id), rdo_signatures(kind)")
        .order("report_date", { ascending: false })
        .limit(500);
      return data ?? [];
    },
  });
  const rows = useMemo(
    () =>
      (list.data ?? []).filter((r) => {
        const hay = `${r.number} ${r.works?.name} ${r.works?.clients?.name} ${r.responsible_name}`.toLowerCase();
        return (
          (!f.text || hay.includes(f.text.toLowerCase())) &&
          (!f.from || r.report_date >= f.from) &&
          (!f.to || r.report_date <= f.to) &&
          (f.status === "all" || r.status === f.status)
        );
      }),
    [list.data, f],
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Input className="sm:col-span-4" placeholder="Obra, cliente ou responsável" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="De" />
        <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Até" />
        <Select value={f.status} onValueChange={(status) => setF({ ...f, status })}>
          <SelectTrigger className="sm:col-span-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="finalized">Finalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {list.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {!list.isLoading && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhum RDO encontrado.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const team = r.rdo_workforce ?? [];
          return (
            <div key={r.id} className="panel space-y-2 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{r.works ? workLabel(r.works) : "—"}</p>
                  <p className="text-xs text-muted-foreground">Nº {String(r.number ?? "").padStart(4, "0")} · {formatDateBR(r.report_date)} · {r.responsible_name ?? "—"}</p>
                </div>
                <Badge variant={r.status === "draft" ? "secondary" : "default"}>{RDO_STATUS_LABEL[r.status] ?? r.status}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Efetivo {team.filter((t) => t.present).length}/{team.length} · {(r.rdo_media ?? []).length} anexo(s) · {(r.rdo_signatures ?? []).length}/2 assinaturas
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => onOpen(r.work_id, r.report_date)}>
                  <Pencil className="h-4 w-4" /> {r.status === "draft" ? "Abrir / editar" : "Visualizar"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => toast.promise(exportRdoPdf(r.id), { loading: "Gerando PDF...", success: "PDF gerado", error: (e) => e.message })}>
                  <FileDown className="h-4 w-4" /> PDF
                </Button>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label="Excluir RDO"
                    onClick={async () => {
                      if (!confirm(`Excluir o RDO Nº ${String(r.number ?? "").padStart(4, "0")}? Fotos, efetivo e assinaturas dele também serão apagados.`)) return;
                      const { error } = await supabase.from("rdos").delete().eq("id", r.id);
                      if (error) { toast.error(error.message); return; }
                      toast.success("RDO excluído");
                      void list.refetch();
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown, Loader2, Pencil, Trash2 } from "lucide-react";
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
import { exportRdoPdf, generateRdoPdfBlob } from "@/lib/rdo-pdf";
import { deliverRdoFile, downloadRdoFile, prepareRdoDownload, type RdoPdfFile } from "@/lib/rdo-download";

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
  const { user, canWrite, role } = useCurrentUser();
  const [tab, setTab] = useState("fill");
  const [workId, setWorkId] = useState<string>("");
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<"service" | "client">("service");
  const [clientId, setClientId] = useState<string>("");

  const works = useQuery({
    queryKey: ["rdo-works", user?.id, role],
    enabled: !!user?.id,
    queryFn: async () => {
      const sel = "id, name, client_id, entry_time, exit_time, exit_time_weekend, active, clients(name)";
      if (role === "admin" || role === "programmer") {
        const { data } = await supabase.from("works").select(sel).eq("active", true);
        return data ?? [];
      }
      if (role === "cliente") {
        // Cargo Cliente: só os serviços marcados, um a um
        const { data: links } = await supabase.from("foreman_works").select("work_id").eq("user_id", user!.id);
        const ids = (links ?? []).map((l) => l.work_id);
        if (!ids.length) return [];
        const { data } = await supabase.from("works").select(sel).in("id", ids).eq("active", true);
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

  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of works.data ?? []) if (w.client_id) m.set(w.client_id, w.clients?.name ?? "Sem nome");
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [works.data]);

  const general = useQuery({
    queryKey: ["rdo-general-work", clientId],
    enabled: mode === "client" && !!clientId,
    queryFn: async () => {
      const { data: id, error } = await (supabase as any).rpc("rdo_general_work", { _client_id: clientId });
      if (error) throw error;
      const { data } = await supabase.from("works").select("id, name, client_id, entry_time, exit_time, exit_time_weekend, active, rdo_general, clients(name)").eq("id", id).single();
      return data;
    },
  });

  const work = mode === "client" ? (general.data ?? undefined) : works.data?.find((w) => w.id === workId);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Relatório Diário de Obras — RDO" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="fill">Preencher</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="fill" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_170px_180px]">
            <div>
              <Label>{mode === "client" ? "Cliente" : "Obra"}</Label>
              {mode === "client" ? (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger className="h-12"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {clientOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
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
              )}
            </div>
            <div>
              <Label>RDO por</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "service" | "client")}>
                <SelectTrigger className="h-12"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Serviço</SelectItem>
                  <SelectItem value="client">Cliente (RDO Geral)</SelectItem>
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
            onOpen={(w, d, generalClient) => { if (generalClient) { setMode("client"); setClientId(generalClient); } else { setMode("service"); chooseWork(w); } setDate(d); setTab("fill"); }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RdoHistory({ onOpen }: { onOpen: (workId: string, date: string, generalClient?: string | null) => void }) {
  const { isAdmin, canWrite } = useCurrentUser();
  const [f, setF] = useState({ text: "", from: "", to: "", status: "all", client: "all", work: "all" });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [ready, setReady] = useState<RdoPdfFile | null>(null);
  const list = useQuery({
    queryKey: ["rdo-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rdos")
        .select("id, number, work_id, report_date, status, responsible_name, works(name, client_id, rdo_general, clients(name)), rdo_workforce(present), rdo_media(id), rdo_signatures(kind)")
        .order("report_date", { ascending: false })
        .limit(500);
      return data ?? [];
    },
  });
  const clients = useMemo(() => {
    const options = new Map<string, string>();
    for (const r of list.data ?? []) {
      if (r.works?.client_id) options.set(r.works.client_id, r.works.clients?.name ?? "Sem nome");
    }
    return [...options].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [list.data]);
  const services = useMemo(() => {
    const options = new Map<string, string>();
    for (const r of list.data ?? []) {
      if (r.works && (f.client === "all" || r.works.client_id === f.client)) {
        options.set(r.work_id, r.works.name);
      }
    }
    return [...options].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [list.data, f.client]);
  const rows = useMemo(
    () =>
      (list.data ?? []).filter((r) => {
        const hay = `${r.number} ${r.works?.name} ${r.works?.clients?.name} ${r.responsible_name}`.toLowerCase();
        return (
          (!f.text || hay.includes(f.text.toLowerCase())) &&
          (!f.from || r.report_date >= f.from) &&
          (!f.to || r.report_date <= f.to) &&
          (f.client === "all" || r.works?.client_id === f.client) &&
          (f.work === "all" || r.work_id === f.work) &&
          (f.status === "all" || r.status === f.status)
        );
      }),
    [list.data, f],
  );
  useEffect(() => { setReady(null); }, [rows]);

  async function downloadFiltered() {
    if (progress || !rows.length) return;
    if (ready) {
      try { await deliverRdoFile(ready); }
      catch { toast.error("Não foi possível baixar os RDOs. Tente novamente."); }
      return;
    }
    const ids = rows.map((r) => r.id);
    setProgress({ done: 0, total: ids.length });
    try {
      const file = await prepareRdoDownload(ids, generateRdoPdfBlob, (done, total) => setProgress({ done, total }));
      setReady(file);
      // Touch devices use a second, synchronous click to retain download/share activation.
      if (!matchMedia("(pointer: coarse)").matches) downloadRdoFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar os RDOs. Tente novamente.");
    } finally {
      setProgress(null);
    }
  }
  return (
    <div className="space-y-3">
      <fieldset disabled={!!progress} className="grid min-w-0 gap-2 sm:grid-cols-4">
        <div className="min-w-0 space-y-1 sm:col-span-2">
          <Label htmlFor="rdo-history-client">Cliente</Label>
          <Select disabled={!!progress} value={f.client} onValueChange={(client) => setF({ ...f, client, work: "all" })}>
            <SelectTrigger id="rdo-history-client" className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os clientes</SelectItem>
              {clients.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1 sm:col-span-2">
          <Label htmlFor="rdo-history-work">Serviço</Label>
          <Select disabled={!!progress} value={f.work} onValueChange={(work) => setF({ ...f, work })}>
            <SelectTrigger id="rdo-history-work" className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os serviços</SelectItem>
              {services.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Input className="sm:col-span-4" placeholder="Obra, cliente ou responsável" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="De" />
        <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Até" />
        <Select disabled={!!progress} value={f.status} onValueChange={(status) => setF({ ...f, status })}>
          <SelectTrigger className="sm:col-span-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="finalized">Finalizado</SelectItem>
          </SelectContent>
        </Select>
      </fieldset>
      <Button variant="outline" className="max-w-full whitespace-normal" disabled={list.isFetching || !rows.length || !!progress} onClick={() => void downloadFiltered()}>
        {progress ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <FileDown className="h-4 w-4 shrink-0" />}
        <span aria-live="polite">
          {progress ? `Gerando ${progress.done} de ${progress.total}...` : ready ? `Baixar ${rows.length === 1 ? "PDF" : "ZIP"} (${rows.length})` : `Baixar RDOs filtrados (${rows.length})`}
        </span>
      </Button>
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
                {canWrite && (
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

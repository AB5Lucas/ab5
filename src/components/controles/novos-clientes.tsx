import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, Check, Download, ClipboardCheck, ListChecks, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { AppointmentDialog } from "@/components/appointment-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchAll } from "@/lib/results-engine";
import { formatDateBR, todayISO } from "@/lib/scheduling";
import { normText } from "@/lib/import-helpers";
import { cn } from "@/lib/utils";

/**
 * Documentação em novos clientes: como a Conferência, mas sem depender de integração cadastrada. Cada acompanhamento
 * é um colaborador × cliente com os documentos enviados (ASO, treinamentos ou outro); cada documento é aceito à parte
 * e o acompanhamento vai para o histórico quando todos forem aceitos. Nada aqui altera ASO, treinamentos ou integrações.
 */
type Onboarding = {
  id: string; client_id: string; collaborator_id: string; status: string; sent_at: string | null; next_check_date: string | null;
  notes: string | null; completed_at: string | null; completed_by: string | null; created_at: string;
};
type Doc = { id: string; onboarding_id: string; kind: "aso" | "treinamento" | "outro"; training_id: string | null; label: string | null; approved: boolean; approved_at: string | null };
type NewDoc = { kind: Doc["kind"]; training_id: string | null; label: string | null };

const NONE = "__all__";

export function NewClientDocsPage() {
  const { canWrite, user } = useCurrentUser();
  const qc = useQueryClient();
  const today = todayISO();
  const [history, setHistory] = useState(false);
  const [fClient, setFClient] = useState(NONE);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [checkId, setCheckId] = useState<string | null>(null);
  // Agendar a integração no cliente (ao agendar, o acompanhamento vai sozinho ao histórico).
  const [booking, setBooking] = useState<{ key: string; collaboratorId: string; clientId: string } | null>(null);
  const [deleteItem, setDeleteItem] = useState<Onboarding | null>(null);

  const onboardings = useQuery({
    queryKey: ["client-onboarding", "items"],
    // Sempre relê ao abrir: a integração agendada em outra tela tira o liberado da lista.
    refetchOnMount: "always",
    queryFn: () => fetchAll<Onboarding>((a, b) => supabase.from("client_onboardings")
      .select("id, client_id, collaborator_id, status, sent_at, next_check_date, notes, completed_at, completed_by, created_at").order("created_at", { ascending: false }).range(a, b)),
  });
  const docs = useQuery({
    queryKey: ["client-onboarding", "docs"],
    queryFn: async () => (await fetchAll<any>((a, b) => supabase.from("client_onboarding_docs").select("id, onboarding_id, kind, training_id, label, approved, approved_at").order("created_at").range(a, b))) as Doc[],
  });
  const people = useQuery({
    queryKey: ["onboarding-people"],
    staleTime: 10 * 60_000,
    queryFn: () => fetchAll<{ id: string; full_name: string; registration_number: string | null; status: string }>((a, b) => supabase.from("collaborators")
      .select("id, full_name, registration_number, status").order("full_name").range(a, b)),
  });
  const clients = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => (await supabase.from("clients").select("id, name, city, state").order("name")).data ?? [],
  });
  const trainings = useQuery({
    queryKey: ["trainings-min"],
    queryFn: async () => (await supabase.from("trainings").select("id, name, description, validity_months").order("name")).data ?? [],
  });
  const asos = useQuery({
    queryKey: ["onboarding-asos"],
    queryFn: () => fetchAll<{ collaborator_id: string; expires_at: string | null }>((a, b) => supabase.from("asos").select("collaborator_id, expires_at").range(a, b)),
  });
  const done = useQuery({
    queryKey: ["onboarding-trainings"],
    queryFn: () => fetchAll<{ collaborator_id: string; training_id: string; expires_at: string | null }>((a, b) => supabase.from("collaborator_trainings").select("collaborator_id, training_id, expires_at").range(a, b)),
  });
  const profiles = useQuery({
    queryKey: ["users-profiles-min"],
    queryFn: async () => (await supabase.from("users_profiles").select("id, full_name, email")).data ?? [],
  });

  const personById = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p])), [people.data]);
  const clientById = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const trainingById = useMemo(() => new Map((trainings.data ?? []).map((t) => [t.id, t.description ? `${t.name} — ${t.description}` : t.name])), [trainings.data]);
  const userById = useMemo(() => new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email])), [profiles.data]);
  const docsBy = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of docs.data ?? []) m.set(d.onboarding_id, [...(m.get(d.onboarding_id) ?? []), d]);
    return m;
  }, [docs.data]);
  // Validade no cadastro (só para informar; o acompanhamento não altera o cadastro).
  const asoExp = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of asos.data ?? []) if (a.expires_at && (!m.has(a.collaborator_id) || a.expires_at > m.get(a.collaborator_id)!)) m.set(a.collaborator_id, a.expires_at);
    return m;
  }, [asos.data]);
  const trnExp = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const t of done.data ?? []) {
      const k = `${t.collaborator_id}|${t.training_id}`;
      const cur = m.get(k);
      if (!m.has(k) || (t.expires_at ?? "9999") > (cur ?? "9999")) m.set(k, t.expires_at);
    }
    return m;
  }, [done.data]);

  const docLabel = (d: Pick<Doc, "kind" | "training_id" | "label">) =>
    d.kind === "aso" ? "Exame ASO" : d.kind === "treinamento" ? (d.training_id ? trainingById.get(d.training_id) ?? "Treinamento" : "Treinamento") : d.label ?? "Documento";
  const validity = (collaboratorId: string, d: Pick<Doc, "kind" | "training_id">) => {
    if (d.kind === "outro") return null;
    const has = d.kind === "aso" ? asoExp.has(collaboratorId) : trnExp.has(`${collaboratorId}|${d.training_id}`);
    const exp = d.kind === "aso" ? asoExp.get(collaboratorId) ?? null : trnExp.get(`${collaboratorId}|${d.training_id}`) ?? null;
    if (!has) return { text: "sem registro no cadastro", tone: "text-destructive" };
    if (!exp) return { text: "sem vencimento", tone: "text-muted-foreground" };
    return exp < today ? { text: `vencido em ${formatDateBR(exp)}`, tone: "text-destructive" } : { text: `válido até ${formatDateBR(exp)}`, tone: "text-muted-foreground" };
  };

  const rows = useMemo(() => {
    const q = normText(search);
    return (onboardings.data ?? []).filter((o) => {
      if (history ? o.status !== "concluido" : o.status === "concluido") return false;
      if (fClient !== NONE && o.client_id !== fClient) return false;
      if (q) {
        const p = personById.get(o.collaborator_id);
        if (!normText(`${p?.full_name ?? ""} ${p?.registration_number ?? ""} ${clientById.get(o.client_id) ?? ""}`).includes(q)) return false;
      }
      return true;
    }).sort((a, b) => history
      ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
      // Liberados para integrar ficam em cima.
      : Number(b.status === "liberado") - Number(a.status === "liberado")
        || (a.next_check_date ?? "9999").localeCompare(b.next_check_date ?? "9999")
        || (clientById.get(a.client_id) ?? "").localeCompare(clientById.get(b.client_id) ?? "", "pt-BR")
        || (personById.get(a.collaborator_id)?.full_name ?? "").localeCompare(personById.get(b.collaborator_id)?.full_name ?? "", "pt-BR"));
  }, [onboardings.data, history, fClient, search, personById, clientById]);

  // Baixa a lista filtrada da tela (em acompanhamento ou histórico).
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const data = rows.map((o) => {
      const p = personById.get(o.collaborator_id);
      const list = docsBy.get(o.id) ?? [];
      return {
        Colaborador: p?.full_name ?? "",
        "Matrícula": p?.registration_number ?? "",
        Cliente: clientById.get(o.client_id) ?? "",
        "Situação": o.status === "liberado" ? "Liberado para integrar" : o.status === "concluido" ? "Concluído" : "Pendente",
        "Enviado em": o.sent_at ? formatDateBR(o.sent_at) : "",
        "Próxima conferência": o.next_check_date ? formatDateBR(o.next_check_date) : "",
        "Concluído em": o.completed_at ? formatDateBR(o.completed_at.slice(0, 10)) : "",
        "Documentos OK": `${list.filter((d) => d.approved).length}/${list.length}`,
        Documentos: list.map((d) => `${d.approved ? "✓" : "•"} ${docLabel(d)}`).join("; "),
        "Observações": o.notes ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 32 }, { wch: 10 }, { wch: 28 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 13 }, { wch: 12 }, { wch: 60 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Novos Clientes");
    XLSX.writeFile(wb, `novos-clientes-${today}.xlsx`);
  };

  const openList = (onboardings.data ?? []).filter((o) => o.status !== "concluido");
  const lateCount = openList.filter((o) => o.status === "pendente" && o.next_check_date && o.next_check_date <= today).length;
  const releasedCount = openList.filter((o) => o.status === "liberado").length;
  const usedClients = [...new Set((onboardings.data ?? []).map((o) => o.client_id))].sort((a, b) => (clientById.get(a) ?? "").localeCompare(clientById.get(b) ?? "", "pt-BR"));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-onboarding"] });
  const allOk = (id: string) => { const l = docsBy.get(id) ?? []; return l.length > 0 && l.every((d) => d.approved); };

  const conclude = useMutation({
    mutationFn: async (o: Onboarding) => {
      if (!allOk(o.id)) throw new Error("Ainda há documentos pendentes neste cliente");
      // Documentação completa = liberado para integrar; vai ao histórico quando a integração no cliente for agendada/realizada.
      const { error } = await supabase.from("client_onboardings").update({ status: "liberado", completed_at: new Date().toISOString(), completed_by: user?.id ?? null }).eq("id", o.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Documentação concluída: liberado para integrar"); invalidate(); qc.invalidateQueries({ queryKey: ["menu-badges"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reopen = useMutation({
    mutationFn: async (o: Onboarding) => {
      const { error } = await supabase.from("client_onboardings").update({ status: "pendente", completed_at: null, completed_by: null }).eq("id", o.id);
      if (error) throw new Error(error.code === "23505" ? "Já existe um acompanhamento aberto desta pessoa neste cliente" : error.message);
    },
    onSuccess: () => { toast.success("Acompanhamento reaberto"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (o: Onboarding) => {
      const { error } = await supabase.from("client_onboardings").delete().eq("id", o.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Acompanhamento excluído"); setDeleteItem(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const checking = checkId ? (onboardings.data ?? []).find((o) => o.id === checkId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Em acompanhamento</p><p className="font-display text-2xl">{openList.length - releasedCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Liberados para integrar</p><p className={cn("font-display text-2xl", releasedCount > 0 && "text-orange-500")}>{releasedCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Conferência para hoje ou atrasada</p><p className={cn("font-display text-2xl", lateCount > 0 && "text-destructive")}>{lateCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">No histórico</p><p className="font-display text-2xl">{(onboardings.data ?? []).length - openList.length}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-xs">Cliente</Label>
            <Select value={fClient} onValueChange={setFClient}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Todos</SelectItem>
                {usedClients.map((id) => <SelectItem key={id} value={id}>{clientById.get(id) ?? "—"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Colaborador</Label>
            <Input placeholder="Nome, matrícula ou cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="block text-xs">&nbsp;</Label>
            <Button variant={history ? "default" : "outline"} className="w-full" onClick={() => setHistory((h) => !h)}>
              <ClipboardCheck className="h-4 w-4" /> {history ? "Ver em acompanhamento" : "Histórico"}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="block text-xs">&nbsp;</Label>
            <Button className="w-full" disabled={!canWrite} onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Incluir
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="block text-xs">&nbsp;</Label>
            <Button variant="outline" className="w-full" disabled={!rows.length} onClick={exportExcel}>
              <Download className="h-4 w-4" /> Exportar Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Matrícula</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Enviado em</TableHead>
              <TableHead>Documentos</TableHead>
              <TableHead>{history ? "Concluído em" : "Próxima conferência"}</TableHead>
              <TableHead className="text-right">{history ? "Responsável" : "Ações"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {onboardings.isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">{history ? "Nada no histórico." : "Nenhum acompanhamento aberto. Use Incluir para começar."}</TableCell></TableRow>
            ) : rows.map((o) => {
              const p = personById.get(o.collaborator_id);
              const list = docsBy.get(o.id) ?? [];
              const ok = list.filter((d) => d.approved).length;
              const late = !history && o.next_check_date && o.next_check_date <= today;
              return (
                <TableRow key={o.id}>
                  <TableCell className="text-xs">{p?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p?.registration_number ?? "—"}</TableCell>
                  <TableCell className="text-xs">{clientById.get(o.client_id) ?? "—"}</TableCell>
                  <TableCell className="text-xs">{o.sent_at ? formatDateBR(o.sent_at) : "—"}</TableCell>
                  <TableCell className="text-xs">
                    <button type="button" onClick={() => setCheckId(o.id)} title={list.map((d) => `${d.approved ? "✓" : "•"} ${docLabel(d)}`).join("\n")}>
                      <Badge variant={list.length && ok === list.length ? "default" : "secondary"}>{ok}/{list.length} OK</Badge>
                    </button>
                  </TableCell>
                  <TableCell className={cn("text-xs", late && o.status === "pendente" && "font-medium text-destructive")}>
                    {history ? (o.completed_at ? formatDateBR(o.completed_at.slice(0, 10)) : "—")
                      : o.status === "liberado"
                        ? <Badge className="bg-orange-500 text-white hover:bg-orange-500" title="Documentação completa: agende a integração (ao agendar, vai para o histórico)">Liberado para integrar</Badge>
                        : o.next_check_date ? formatDateBR(o.next_check_date) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {history ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-muted-foreground">{o.completed_by ? userById.get(o.completed_by) ?? "—" : "—"}</span>
                        {canWrite && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Reabrir" aria-label="Reabrir acompanhamento" disabled={reopen.isPending} onClick={() => reopen.mutate(o)}>
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ) : canWrite ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Agendar integração neste cliente" aria-label="Agendar integração"
                          onClick={() => setBooking({ key: `${o.id}|${Date.now()}`, collaboratorId: o.collaborator_id, clientId: o.client_id })}>
                          <CalendarClock className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Conferir documentos" aria-label="Conferir documentos" onClick={() => setCheckId(o.id)}>
                          <ListChecks className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Excluir" aria-label="Excluir acompanhamento" onClick={() => setDeleteItem(o)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                        {o.status === "liberado" ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Voltar para conferência" aria-label="Voltar para conferência" disabled={reopen.isPending} onClick={() => reopen.mutate(o)}>
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Concluir documentação (todos aceitos): liberado para integrar" aria-label="Concluir acompanhamento" disabled={!allOk(o.id) || conclude.isPending} onClick={() => conclude.mutate(o)}>
                            <Check className="h-4 w-4 text-emerald-500" />
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AddOnboarding
        open={adding}
        onOpenChange={setAdding}
        clients={clients.data ?? []}
        people={(people.data ?? []).filter((p) => p.status === "active")}
        trainings={(trainings.data ?? []).map((t) => ({ id: t.id, label: trainingById.get(t.id) ?? t.name }))}
        openKeys={new Set(openList.map((o) => `${o.client_id}|${o.collaborator_id}`))}
        onDone={invalidate}
      />

      {booking && (
        <AppointmentDialog
          key={booking.key}
          type="integracao"
          open
          onOpenChange={(v) => { if (!v) { setBooking(null); invalidate(); } }}
          initialValues={{ collaborator_id: booking.collaboratorId, client_id: booking.clientId }}
        />
      )}

      {checking && (
        <CheckDialog
          key={checking.id}
          item={checking}
          docs={docsBy.get(checking.id) ?? []}
          title={`${personById.get(checking.collaborator_id)?.full_name ?? ""} — ${clientById.get(checking.client_id) ?? ""}`}
          docLabel={docLabel}
          validity={(d) => validity(checking.collaborator_id, d)}
          trainings={(trainings.data ?? []).map((t) => ({ id: t.id, label: trainingById.get(t.id) ?? t.name }))}
          editable={canWrite && checking.status === "pendente"}
          userId={user?.id ?? null}
          onClose={() => setCheckId(null)}
          onChanged={invalidate}
        />
      )}

      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este acompanhamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem ? `${personById.get(deleteItem.collaborator_id)?.full_name ?? ""} — ${clientById.get(deleteItem.client_id) ?? ""}. Ele não vai para o histórico.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={remove.isPending} onClick={(e) => { e.preventDefault(); if (deleteItem) remove.mutate(deleteItem); }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Incluir: um cliente, várias pessoas e os documentos enviados (os mesmos para todas). */
function AddOnboarding({ open, onOpenChange, clients, people, trainings, openKeys, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  clients: { id: string; name: string }[];
  people: { id: string; full_name: string; registration_number: string | null }[];
  trainings: { id: string; label: string }[];
  openKeys: Set<string>; onDone: () => void;
}) {
  // "docs" = acompanhar documentos; "integrar" = já liberado, só falta integrar (sem documentos).
  const [mode, setMode] = useState<"docs" | "integrar">("docs");
  const [clientId, setClientId] = useState("");
  const [who, setWho] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [aso, setAso] = useState(true);
  const [trn, setTrn] = useState<Set<string>>(new Set());
  const [tq, setTq] = useState("");
  const [others, setOthers] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [sentAt, setSentAt] = useState(todayISO());
  const [next, setNext] = useState("");
  const reset = () => { setMode("docs"); setClientId(""); setWho(new Set()); setQ(""); setAso(true); setTrn(new Set()); setTq(""); setOthers([]); setOther(""); setSentAt(todayISO()); setNext(""); };

  const found = useMemo(() => {
    const t = normText(q.trim());
    return t.length < 2 ? [] : people.filter((p) => !who.has(p.id) && normText(`${p.full_name} ${p.registration_number ?? ""}`).includes(t)).slice(0, 8);
  }, [q, people, who]);
  const trnList = useMemo(() => {
    const t = normText(tq.trim());
    return trainings.filter((x) => trn.has(x.id) || !t || normText(x.label).includes(t));
  }, [tq, trainings, trn]);
  const nameOf = new Map(people.map((p) => [p.id, p.full_name]));

  const save = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("Escolha o cliente.");
      if (!who.size) throw new Error("Inclua ao menos um colaborador.");
      const extra = other.trim() ? [...others, other.trim()] : others;
      const newDocs: NewDoc[] = [
        ...(aso ? [{ kind: "aso" as const, training_id: null, label: null }] : []),
        ...[...trn].map((id) => ({ kind: "treinamento" as const, training_id: id, label: null })),
        ...extra.map((l) => ({ kind: "outro" as const, training_id: null, label: l })),
      ];
      if (mode === "docs" && !newDocs.length) throw new Error("Marque ao menos um documento.");
      const ids = [...who].filter((id) => !openKeys.has(`${clientId}|${id}`));
      const skipped = who.size - ids.length;
      if (!ids.length) throw new Error("Todos já têm acompanhamento aberto neste cliente.");
      const { data, error } = await supabase.from("client_onboardings")
        .insert(ids.map((collaborator_id) => mode === "integrar"
          ? { client_id: clientId, collaborator_id, sent_at: sentAt || null, status: "liberado", completed_at: new Date().toISOString() }
          : { client_id: clientId, collaborator_id, sent_at: sentAt || null, next_check_date: next || null }))
        .select("id");
      if (error) throw new Error(error.code === "23505" ? "Alguém já tem acompanhamento aberto neste cliente." : error.message);
      if (mode === "docs") {
        const rows = (data ?? []).flatMap((o) => newDocs.map((d) => ({ ...d, onboarding_id: o.id })));
        const { error: dErr } = await supabase.from("client_onboarding_docs").insert(rows);
        if (dErr) throw dErr;
      }
      return { created: ids.length, skipped };
    },
    onSuccess: (r) => {
      toast.success(`${r.created} ${mode === "integrar" ? "liberado(s) para integrar" : "acompanhamento(s) incluído(s)"}${r.skipped ? `; ${r.skipped} já tinha(m) acompanhamento aberto` : ""}`);
      onDone(); reset(); onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Incluir em novo cliente</DialogTitle>
          <DialogDescription>{mode === "docs" ? "Escolha o cliente, as pessoas e os documentos enviados." : "A pessoa entra como liberada para integrar, sem conferir documentos."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="inline-flex rounded-md border border-border p-0.5">
            <Button type="button" size="sm" variant={mode === "docs" ? "default" : "ghost"} onClick={() => setMode("docs")}>Documentação</Button>
            <Button type="button" size="sm" variant={mode === "integrar" ? "default" : "ghost"} onClick={() => setMode("integrar")}>Só integrar</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="onb-sent">Enviado em</Label>
              <Input id="onb-sent" type="date" value={sentAt} onChange={(e) => setSentAt(e.target.value)} />
            </div>
            {mode === "docs" && (
              <div className="space-y-1">
                <Label htmlFor="onb-next">Próxima conferência</Label>
                <Input id="onb-next" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label>Colaboradores ({who.size})</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Digite o nome ou a matrícula" value={q} onChange={(e) => setQ(e.target.value)} />
              {found.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
                  {found.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={() => { setWho((s) => new Set(s).add(p.id)); setQ(""); }}>
                        <span className="truncate">{p.full_name}</span>
                        {clientId && openKeys.has(`${clientId}|${p.id}`) && <span className="ml-auto text-xs text-muted-foreground">já em acompanhamento</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {who.size > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {[...who].map((id) => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {nameOf.get(id) ?? "—"}
                    <button type="button" aria-label="Tirar" onClick={() => setWho((s) => { const n = new Set(s); n.delete(id); return n; })}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {mode === "docs" && <div className="space-y-2">
            <Label>Documentos enviados</Label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={aso} onCheckedChange={(v) => setAso(!!v)} /> Exame ASO</label>
            <div className="space-y-1">
              <Input placeholder="Filtrar treinamentos" value={tq} onChange={(e) => setTq(e.target.value)} />
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {trnList.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={trn.has(t.id)} onCheckedChange={(v) => setTrn((s) => { const n = new Set(s); if (v) n.add(t.id); else n.delete(t.id); return n; })} />
                    <span className="truncate">{t.label}</span>
                  </label>
                ))}
                {!trnList.length && <p className="text-xs text-muted-foreground">Nenhum treinamento.</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="onb-other" className="text-xs">Outro documento (ex.: ficha de registro, CTPS, ordem de serviço)</Label>
              <div className="flex gap-2">
                <Input id="onb-other" value={other} onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && other.trim()) { e.preventDefault(); setOthers((l) => [...l, other.trim()]); setOther(""); } }} />
                <Button type="button" variant="outline" disabled={!other.trim()} onClick={() => { setOthers((l) => [...l, other.trim()]); setOther(""); }}><Plus className="h-4 w-4" /></Button>
              </div>
              {others.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {others.map((l, i) => (
                    <Badge key={`${l}-${i}`} variant="secondary" className="gap-1">
                      {l}
                      <button type="button" aria-label="Tirar" onClick={() => setOthers((s) => s.filter((_, j) => j !== i))}><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Incluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Conferir: aceitar cada documento no cliente, incluir outro documento, próxima conferência e observações. */
function CheckDialog({ item, docs, title, docLabel, validity, trainings, editable, userId, onClose, onChanged }: {
  item: Onboarding; docs: Doc[]; title: string;
  docLabel: (d: Doc) => string;
  validity: (d: Doc) => { text: string; tone: string } | null;
  trainings: { id: string; label: string }[];
  editable: boolean; userId: string | null; onClose: () => void; onChanged: () => void;
}) {
  const [next, setNext] = useState(item.next_check_date ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [addKind, setAddKind] = useState<string>("");
  const [addLabel, setAddLabel] = useState("");

  const toggle = useMutation({
    mutationFn: async (d: Doc) => {
      const { error } = await supabase.from("client_onboarding_docs")
        .update(d.approved ? { approved: false, approved_at: null, approved_by: null } : { approved: true, approved_at: new Date().toISOString(), approved_by: userId })
        .eq("id", d.id);
      if (error) throw error;
    },
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message),
  });
  const removeDoc = useMutation({
    mutationFn: async (d: Doc) => { const { error } = await supabase.from("client_onboarding_docs").delete().eq("id", d.id); if (error) throw error; },
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message),
  });
  const addDoc = useMutation({
    mutationFn: async () => {
      const row = addKind === "aso" ? { kind: "aso", training_id: null, label: null }
        : addKind === "outro" ? { kind: "outro", training_id: null, label: addLabel.trim() || null }
        : { kind: "treinamento", training_id: addKind, label: null };
      if (row.kind === "outro" && !row.label) throw new Error("Escreva o nome do documento.");
      const { error } = await supabase.from("client_onboarding_docs").insert({ ...row, onboarding_id: item.id });
      if (error) throw error;
    },
    onSuccess: () => { setAddKind(""); setAddLabel(""); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveInfo = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("client_onboardings").update({ next_check_date: next || null, notes: notes.trim() || null }).eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Acompanhamento salvo"); onChanged(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conferir documentos</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {!docs.length && <p className="text-sm text-muted-foreground">Nenhum documento neste acompanhamento.</p>}
          {docs.map((d) => {
            const v = validity(d);
            return (
              <div key={d.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{docLabel(d)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {v && <span className={v.tone}>{v.text}</span>}
                    {d.approved && d.approved_at && <span>{v ? " · " : ""}aceito em {formatDateBR(d.approved_at.slice(0, 10))}</span>}
                  </p>
                </div>
                {d.approved ? <Badge>✓ OK</Badge> : <Badge variant="secondary">Pendente</Badge>}
                {editable && (
                  <>
                    <Button size="sm" variant={d.approved ? "ghost" : "default"} className="h-8" disabled={toggle.isPending} onClick={() => toggle.mutate(d)}>
                      {d.approved ? <><Undo2 className="h-4 w-4" /> Desfazer</> : <><Check className="h-4 w-4" /> Aceito</>}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Tirar documento" disabled={removeDoc.isPending} onClick={() => removeDoc.mutate(d)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {editable && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label className="text-xs">Incluir documento</Label>
              <Select value={addKind} onValueChange={setAddKind}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aso">Exame ASO</SelectItem>
                  <SelectItem value="outro">Outro documento</SelectItem>
                  {trainings.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {addKind === "outro" && <Input placeholder="Nome do documento" value={addLabel} onChange={(e) => setAddLabel(e.target.value)} />}
            </div>
            <div className="space-y-1">
              <Label className="block text-xs">&nbsp;</Label>
              <Button variant="outline" disabled={!addKind || addDoc.isPending} onClick={() => addDoc.mutate()}><Plus className="h-4 w-4" /> Incluir</Button>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
          <div className="space-y-1">
            <Label htmlFor="chk-next" className="text-xs">Próxima conferência</Label>
            <Input id="chk-next" type="date" className="w-44" value={next} disabled={!editable} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="chk-notes" className="text-xs">Observações</Label>
            <Textarea id="chk-notes" rows={2} value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: cliente pediu nova foto do ASO" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          {editable && <Button disabled={saveInfo.isPending} onClick={() => saveInfo.mutate()}>Salvar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ClipboardCheck, CalendarDays, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateBR } from "@/lib/scheduling";
import { normText } from "@/lib/import-helpers";
import { APPOINTMENT_TYPE_LABEL } from "@/components/appointment-dialog";
import type { AppointmentType } from "@/components/appointment-dialog";

export const Route = createFileRoute("/_authenticated/conferencia")({
  head: () => ({
    meta: [
      { title: "Conferência | Programação Operacional" },
      {
        name: "description",
        content:
          "Conferência dos documentos realizados (ASO, treinamento e integração) por cliente, com data da próxima conferência e histórico.",
      },
      { property: "og:title", content: "Conferência | Programação Operacional" },
      {
        property: "og:description",
        content: "Controle da aceitação dos documentos em cada cliente e histórico das conferências concluídas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConferencePage,
});

type Item = {
  id: string;
  collaborator_id: string;
  type: AppointmentType;
  training_id: string | null;
  client_id: string | null;
  document_date: string;
  status: string;
  notes: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
};

type CheckRow = {
  id: string;
  item_id: string;
  client_id: string;
  approved: boolean;
  approved_at: string | null;
  next_check_date: string | null;
};

function ConferencePage() {
  const { canWrite, user } = useCurrentUser();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"ativos" | "historico">("ativos");
  const [fType, setFType] = useState("all");
  const [search, setSearch] = useState("");
  const [checkItem, setCheckItem] = useState<Item | null>(null);
  const [deleteItem, setDeleteItem] = useState<Item | null>(null);
  const [docItem, setDocItem] = useState<Item | null>(null);
  const [docDate, setDocDate] = useState("");
  const [dateDraft, setDateDraft] = useState<Record<string, string>>({});

  const items = useQuery({
    queryKey: ["conference", "items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_items")
        .select(
          "id, collaborator_id, type, training_id, client_id, document_date, status, notes, completed_at, completed_by, created_at",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Item[];
    },
  });

  const checks = useQuery({
    queryKey: ["conference", "checks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conference_checks")
        .select("id, item_id, client_id, approved, approved_at, next_check_date");
      if (error) throw error;
      return data as unknown as CheckRow[];
    },
  });

  const collaborators = useQuery({
    queryKey: ["collaborators-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborators")
        .select("id, full_name, registration_number")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const trainings = useQuery({
    queryKey: ["trainings-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trainings")
        .select("id, name, description, validity_months")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const clients = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, city, state").order("name");
      if (error) throw error;
      return data;
    },
  });

  const profiles = useQuery({
    queryKey: ["users-profiles-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("users_profiles").select("id, full_name, email");
      if (error) throw error;
      return data;
    },
  });

  const personById = useMemo(() => {
    const m = new Map<string, { full_name: string; registration_number: string }>();
    (collaborators.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [collaborators.data]);

  const trainingById = useMemo(() => {
    const m = new Map<string, string>();
    (trainings.data ?? []).forEach((t) => m.set(t.id, t.description ? `${t.name} — ${t.description}` : t.name));
    return m;
  }, [trainings.data]);

  const clientById = useMemo(() => {
    const m = new Map<string, string>();
    (clients.data ?? []).forEach((c) => m.set(c.id, c.name));
    return m;
  }, [clients.data]);

  const userById = useMemo(() => {
    const m = new Map<string, string>();
    (profiles.data ?? []).forEach((p) => m.set(p.id, p.full_name || p.email));
    return m;
  }, [profiles.data]);

  const checksByItem = useMemo(() => {
    const m = new Map<string, CheckRow[]>();
    (checks.data ?? []).forEach((c) => {
      const list = m.get(c.item_id) ?? [];
      list.push(c);
      m.set(c.item_id, list);
    });
    for (const list of m.values())
      list.sort((a, b) =>
        (clientById.get(a.client_id) ?? "").localeCompare(clientById.get(b.client_id) ?? "", "pt-BR"),
      );
    return m;
  }, [checks.data, clientById]);

  const docLabel = (i: Item) => {
    if (i.type === "treinamento") return i.training_id ? trainingById.get(i.training_id) ?? "—" : "—";
    if (i.type === "integracao") return `Integração — ${i.client_id ? clientById.get(i.client_id) ?? "—" : "—"}`;
    return "Exame ASO";
  };

  const allApproved = (id: string) => (checksByItem.get(id) ?? []).every((c) => c.approved);

  const nextCheckOf = (id: string) => {
    const dates = (checksByItem.get(id) ?? [])
      .map((c) => c.next_check_date)
      .filter((d): d is string => !!d)
      .sort();
    return dates[0] ?? null;
  };

  const rows = useMemo(() => {
    const q = normText(search);
    return (items.data ?? []).filter((i) => {
      const active = i.status !== "concluido";
      if (tab === "ativos" ? !active : active) return false;
      if (fType !== "all" && i.type !== fType) return false;
      if (q) {
        const p = personById.get(i.collaborator_id);
        const hay = normText(`${p?.full_name ?? ""} ${p?.registration_number ?? ""}`);
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items.data, fType, personById, search, tab]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["conference"] });

  const approve = useMutation({
    mutationFn: async (check: CheckRow) => {
      const { error } = await supabase
        .from("conference_checks")
        .update({ approved: true, approved_at: new Date().toISOString() })
        .eq("id", check.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Documento aceito neste cliente");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDate = useMutation({
    mutationFn: async ({ check, date }: { check: CheckRow; date: string }) => {
      const { error } = await supabase
        .from("conference_checks")
        .update({ next_check_date: date || null })
        .eq("id", check.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Data da próxima conferência salva");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Atualiza o cadastro do colaborador com a data do documento conferido
  const applyToRecords = async (item: Item, date: string) => {
    if (item.type === "aso") {
      const { data: existing } = await supabase
        .from("asos")
        .select("id")
        .eq("collaborator_id", item.collaborator_id)
        .maybeSingle();
      const payload = { collaborator_id: item.collaborator_id, exam_date: date };
      const { error } = existing
        ? await supabase.from("asos").update(payload).eq("id", existing.id)
        : await supabase.from("asos").insert(payload);
      if (error) throw error;
    } else if (item.type === "treinamento" && item.training_id) {
      const months = validityById.get(item.training_id) ?? 12;
      const payload = {
        collaborator_id: item.collaborator_id,
        training_id: item.training_id,
        completed_at: date,
        expires_at: months ? addMonths(date, months) : null,
      };
      const { data: existing } = await supabase
        .from("collaborator_trainings")
        .select("id")
        .eq("collaborator_id", item.collaborator_id)
        .eq("training_id", item.training_id)
        .maybeSingle();
      const { error } = existing
        ? await supabase.from("collaborator_trainings").update(payload).eq("id", existing.id)
        : await supabase.from("collaborator_trainings").insert(payload);
      if (error) throw error;
    } else if (item.type === "integracao" && item.client_id) {
      const payload = {
        collaborator_id: item.collaborator_id,
        client_id: item.client_id,
        integration_date: date,
        expires_at: addMonths(date, 12),
      };
      const { data: existing } = await supabase
        .from("client_integrations")
        .select("id")
        .eq("collaborator_id", item.collaborator_id)
        .eq("client_id", item.client_id)
        .maybeSingle();
      const { error } = existing
        ? await supabase.from("client_integrations").update(payload).eq("id", existing.id)
        : await supabase.from("client_integrations").insert(payload);
      if (error) throw error;
    }
  };

  const conclude = useMutation({

    mutationFn: async (item: Item) => {
      if (!allApproved(item.id)) throw new Error("Ainda há clientes com o documento pendente");

      // Agora sim: atualiza o cadastro do colaborador com a data do documento
      await applyToRecords(item, item.document_date);

      const { error } = await supabase
        .from("conference_items")
        .update({
          status: "concluido",
          completed_at: new Date().toISOString(),
          completed_by: user?.id ?? null,
        })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Conferência concluída e cadastro atualizado");
      invalidate();
      qc.invalidateQueries({ queryKey: ["asos"] });
      qc.invalidateQueries({ queryKey: ["collaborator-trainings"] });
      qc.invalidateQueries({ queryKey: ["client-integrations"] });
      qc.invalidateQueries({ queryKey: ["training-records"] });
      qc.invalidateQueries({ queryKey: ["schedule-ctx"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  const remove = useMutation({
    mutationFn: async (item: Item) => {
      const { error } = await supabase.from("conference_items").delete().eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item excluído da Conferência");
      setDeleteItem(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const validityById = useMemo(() => {
    const m = new Map<string, number>();
    (trainings.data ?? []).forEach((t) => m.set(t.id, t.validity_months ?? 12));
    return m;
  }, [trainings.data]);

  const addMonths = (iso: string, months: number) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  };

  const saveDocDate = useMutation({
    mutationFn: async ({ item, date }: { item: Item; date: string }) => {
      if (!date) throw new Error("Informe a data de realização");
      const { error } = await supabase
        .from("conference_items")
        .update({ document_date: date })
        .eq("id", item.id);
      if (error) throw error;

      // O cadastro só é alterado depois que o item já foi concluído na conferência
      if (item.status === "concluido") {
        await applyToRecords(item, date);
      }

    },
    onSuccess: () => {
      toast.success("Data de realização atualizada");
      setDocItem(null);
      invalidate();
      qc.invalidateQueries({ queryKey: ["asos"] });
      qc.invalidateQueries({ queryKey: ["collaborator-trainings"] });
      qc.invalidateQueries({ queryKey: ["client-integrations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const modalChecks = checkItem ? checksByItem.get(checkItem.id) ?? [] : [];
  const pendingCount = (items.data ?? []).filter((i) => i.status !== "concluido").length;
  const doneCount = (items.data ?? []).filter((i) => i.status === "concluido").length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conferência"
        description="Documentos realizados aguardando aceite em cada cliente. Conclua quando todos estiverem OK."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Em conferência</p>
            <p className="font-display text-2xl">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">No histórico</p>
            <p className="font-display text-2xl">{doneCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Exibindo</p>
            <p className="font-display text-2xl">{rows.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={fType} onValueChange={setFType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="aso">ASO</SelectItem>
                <SelectItem value="treinamento">Treinamento</SelectItem>
                <SelectItem value="integracao">Integração</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Colaborador</Label>
            <Input placeholder="Nome ou matrícula" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              variant={tab === "historico" ? "default" : "outline"}
              size="sm"
              className="w-full"
              onClick={() => setTab((t) => (t === "ativos" ? "historico" : "ativos"))}
            >
              <ClipboardCheck className="h-4 w-4" />
              {tab === "historico" ? "Ver em conferência" : "Histórico"}
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
              <TableHead>Documento</TableHead>
              <TableHead>Realizado em</TableHead>
              <TableHead>Clientes</TableHead>
              <TableHead>{tab === "ativos" ? "Próxima conferência" : "Concluído em"}</TableHead>
              <TableHead className="text-right">{tab === "ativos" ? "Ações" : "Responsável"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  Nenhum item encontrado.
                </TableCell>
              </TableRow>
            )}
            {rows.map((i) => {
              const p = personById.get(i.collaborator_id);
              const list = checksByItem.get(i.id) ?? [];
              const ok = list.filter((c) => c.approved).length;
              const next = nextCheckOf(i.id);
              return (
                <TableRow key={i.id}>
                  <TableCell className="text-xs">{p?.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{p?.registration_number ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-col">
                      <span>{docLabel(i)}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {APPOINTMENT_TYPE_LABEL[i.type]}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{formatDateBR(i.document_date)}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant={ok === list.length ? "default" : "secondary"}>
                      {ok}/{list.length} OK
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {tab === "ativos"
                      ? next
                        ? formatDateBR(next)
                        : "—"
                      : i.completed_at
                        ? formatDateBR(i.completed_at.slice(0, 10))
                        : "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {tab === "historico" ? (
                      <span className="text-muted-foreground">
                        {i.completed_by ? userById.get(i.completed_by) ?? "—" : "—"}
                      </span>
                    ) : canWrite ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Conferir documento"
                          title="Conferir documento"
                          onClick={() => setCheckItem(i)}
                        >
                          <CalendarDays className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Editar data de realização"
                          title="Editar data de realização"
                          onClick={() => {
                            setDocItem(i);
                            setDocDate(i.document_date);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Excluir da conferência"
                          onClick={() => setDeleteItem(i)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label="Concluir conferência"
                          disabled={!allApproved(i.id) || conclude.isPending}
                          onClick={() => conclude.mutate(i)}
                        >
                          <Check className="h-4 w-4 text-emerald-500" />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Conferir por cliente */}
      <Dialog
        open={!!checkItem}
        onOpenChange={(v) => {
          if (!v) {
            setCheckItem(null);
            setDateDraft({});
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Conferir documento</DialogTitle>
            <DialogDescription>
              {checkItem
                ? `${personById.get(checkItem.collaborator_id)?.full_name ?? ""} — ${docLabel(checkItem)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {modalChecks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Este colaborador não possui integração cadastrada em nenhum cliente.
              </p>
            )}
            {modalChecks.map((c) => (
              <div key={c.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{clientById.get(c.client_id) ?? "—"}</span>
                  {c.approved ? (
                    <Badge>✓ Documento OK</Badge>
                  ) : (
                    <Badge variant="secondary">Pendente</Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Próxima conferência</Label>
                    <Input
                      type="date"
                      className="h-8 w-40"
                      value={dateDraft[c.id] ?? c.next_check_date ?? ""}
                      onChange={(e) => setDateDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={saveDate.isPending}
                    onClick={() => saveDate.mutate({ check: c, date: dateDraft[c.id] ?? c.next_check_date ?? "" })}
                  >
                    Salvar data
                  </Button>
                  {!c.approved && (
                    <Button size="sm" className="h-8" disabled={approve.isPending} onClick={() => approve.mutate(c)}>
                      <Check className="h-4 w-4" /> Documento aceito
                    </Button>
                  )}
                  {c.approved && c.approved_at && (
                    <span className="text-xs text-muted-foreground">
                      Aprovado em {formatDateBR(c.approved_at.slice(0, 10))}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setCheckItem(null);
                setDateDraft({});
              }}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar data de realização */}
      <Dialog open={!!docItem} onOpenChange={(v) => !v && setDocItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar data de realização</DialogTitle>
            <DialogDescription>
              {docItem
                ? `${personById.get(docItem.collaborator_id)?.full_name ?? ""} — ${docLabel(docItem)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label className="text-xs">Realizado em</Label>
            <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDocItem(null)}>
              Cancelar
            </Button>
            <Button
              disabled={saveDocDate.isPending}
              onClick={() => docItem && saveDocDate.mutate({ item: docItem, date: docDate })}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Excluir da conferência */}
      <AlertDialog open={!!deleteItem} onOpenChange={(v) => !v && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja realmente excluir este item da Conferência?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem
                ? `${personById.get(deleteItem.collaborator_id)?.full_name ?? ""} — ${docLabel(deleteItem)}. O item não vai para o histórico.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteItem) remove.mutate(deleteItem);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

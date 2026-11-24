import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { useInConference, useScheduled } from "@/hooks/use-scheduled";
import { AppointmentDialog, type AppointmentType } from "@/components/appointment-dialog";
import { SearchSelect } from "@/components/search-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL_LABEL, cellStatus, latestByKey, type CellStatus } from "@/lib/doc-status";
import { fetchAll } from "@/lib/results-engine";
import { formatDateBR, todayISO } from "@/lib/scheduling";
import { copyNameList } from "@/lib/copy-names";
import { normText } from "@/lib/import-helpers";
import { cn } from "@/lib/utils";

/**
 * Documentação › Liberação por cliente: para o cliente escolhido, cada pessoa ativa com ASO, cada treinamento exigido
 * pelo cliente (cadastro do cliente), integração no cliente e Novos Clientes. Célula pendente tem "Agendar", que abre
 * o agendamento do sistema já preenchido.
 */
const TONE: Record<CellStatus, string> = {
  valid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  expiring: "bg-warning/20 text-orange-700 dark:text-orange-300",
  expired: "bg-destructive/15 text-destructive",
  missing: "bg-destructive/15 text-destructive",
  scheduled: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  conference: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};
const ONBOARDING_LABEL: Record<string, string> = { pendente: "Pendente", liberado: "Liberado para integrar", concluido: "Concluído" };

type Cell = { status: CellStatus; expires: string | null; title?: string | undefined };
type Booking = { type: AppointmentType; collaboratorId: string; trainingId?: string | undefined; clientId?: string | undefined; key: string };

export function ClientReleasePage() {
  const { canWrite } = useCurrentUser();
  const today = todayISO();
  const [clientId, setClientId] = useState("");
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(true);
  const [booking, setBooking] = useState<Booking | null>(null);
  const schedAso = useScheduled("aso");
  const schedTrn = useScheduled("treinamento");
  const schedInt = useScheduled("integracao");
  const confAso = useInConference("aso");
  const confTrn = useInConference("treinamento");
  const confInt = useInConference("integracao");

  const clients = useQuery({
    queryKey: ["release-by-client", "clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, city, requires_integration").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });
  const client = (clients.data ?? []).find((c) => c.id === clientId) ?? null;
  const people = useQuery({
    queryKey: ["release-by-client", "people"],
    queryFn: () => fetchAll<{ id: string; full_name: string; registration_number: string | null }>((a, b) => supabase
      .from("collaborators").select("id, full_name, registration_number").eq("status", "active").order("full_name").order("id").range(a, b)),
  });
  const asos = useQuery({
    queryKey: ["release-by-client", "asos"],
    queryFn: () => fetchAll<{ collaborator_id: string; expires_at: string | null }>((a, b) => supabase.from("asos").select("collaborator_id, expires_at").order("id").range(a, b)),
  });
  const required = useQuery({
    queryKey: ["release-by-client", "required", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase.from("client_required_trainings").select("training_id, trainings(name, description)").eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const t = r.trainings as { name: string; description: string | null } | null;
        return { id: r.training_id, label: t ? (t.description ? `${t.name} — ${t.description}` : t.name) : "Treinamento" };
      }).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    },
  });
  const trainingIds = (required.data ?? []).map((t) => t.id);
  const trainings = useQuery({
    queryKey: ["release-by-client", "trainings", trainingIds.join(",")],
    enabled: trainingIds.length > 0,
    queryFn: () => fetchAll<{ collaborator_id: string; training_id: string; expires_at: string | null }>((a, b) => supabase
      .from("collaborator_trainings").select("collaborator_id, training_id, expires_at").in("training_id", trainingIds).order("id").range(a, b)),
  });
  const integrations = useQuery({
    queryKey: ["release-by-client", "integrations", clientId],
    enabled: !!clientId,
    queryFn: () => fetchAll<{ collaborator_id: string; expires_at: string | null; documentation: boolean | null }>((a, b) => supabase
      .from("client_integrations").select("collaborator_id, expires_at, documentation").eq("client_id", clientId).order("id").range(a, b)),
  });
  const onboardings = useQuery({
    queryKey: ["release-by-client", "onboardings", clientId],
    enabled: !!clientId,
    queryFn: () => fetchAll<{ collaborator_id: string; status: string; created_at: string }>((a, b) => supabase
      .from("client_onboardings").select("collaborator_id, status, created_at").eq("client_id", clientId).order("created_at").order("id").range(a, b)),
  });

  const rows = useMemo(() => {
    if (!clientId) return [];
    const asoBy = latestByKey(asos.data ?? [], (x) => x.collaborator_id);
    const trnBy = latestByKey(trainings.data ?? [], (x) => `${x.collaborator_id}|${x.training_id}`);
    const intBy = latestByKey(integrations.data ?? [], (x) => x.collaborator_id);
    const onbBy = new Map<string, string>();
    // Mais recente por pessoa; um aberto (pendente/liberado) vale mais que o histórico.
    for (const o of onboardings.data ?? []) if (onbBy.get(o.collaborator_id) === undefined || o.status !== "concluido") onbBy.set(o.collaborator_id, o.status);
    const q = normText(search);
    const needsInt = client?.requires_integration !== false;
    return (people.data ?? []).filter((p) => !q || normText(`${p.full_name} ${p.registration_number ?? ""}`).includes(q)).map((p) => {
      const a = asoBy.get(p.id);
      const aso: Cell = { expires: a?.expires_at ?? null, status: cellStatus({ has: !!a, expires: a?.expires_at, today, scheduled: schedAso.has(p.id), conference: confAso.has(p.id) }), title: schedAso.get(p.id) };
      const trn = (required.data ?? []).map((t): Cell => {
        const r = trnBy.get(`${p.id}|${t.id}`);
        const k = `${p.id}|${t.id}`;
        return { expires: r?.expires_at ?? null, status: cellStatus({ has: !!r, expires: r?.expires_at, today, scheduled: schedTrn.has(k), conference: confTrn.has(k) }), title: schedTrn.get(k) };
      });
      const i = intBy.get(p.id);
      const ik = `${p.id}|${clientId}`;
      // Em Documentação (integração marcada assim) segue liberada só enquanto não vence, como na Programação.
      const integration: Cell | null = needsInt
        ? { expires: i?.expires_at ?? null, status: cellStatus({ has: !!i, expires: i?.expires_at, today, scheduled: schedInt.has(ik), conference: confInt.has(ik) }), title: schedInt.get(ik) }
        : null;
      const onboarding = onbBy.get(p.id) ?? null;
      const cells = [aso, ...trn, ...(integration ? [integration] : [])];
      const pending = cells.some((c) => c.status !== "valid");
      return { person: p, aso, trn, integration, onboarding, pending };
    }).filter((r) => !onlyPending || r.pending);
  }, [clientId, client, people.data, asos.data, trainings.data, integrations.data, onboardings.data, required.data, search, onlyPending, today,
    schedAso, schedTrn, schedInt, confAso, confTrn, confInt]);

  const total = (people.data ?? []).length;
  const cellView = (c: Cell, book: Omit<Booking, "key"> | null) => (
    <div className="flex items-center gap-1">
      <span className={cn("inline-flex flex-col rounded px-1.5 py-0.5 text-[11px] leading-tight", TONE[c.status])} title={c.title}>
        <span className="font-medium">{CELL_LABEL[c.status]}</span>
        {c.expires && c.status !== "scheduled" && c.status !== "conference" && <span className="opacity-80">{formatDateBR(c.expires)}</span>}
      </span>
      {canWrite && book && ["expired", "missing", "expiring"].includes(c.status) && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Agendar"
          aria-label="Agendar"
          onClick={() => setBooking({ ...book, key: `${book.type}|${book.collaboratorId}|${book.trainingId ?? ""}|${book.clientId ?? ""}|${Date.now()}` })}
        >
          <CalendarClock className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-1 sm:w-72">
          <Label className="block">Cliente</Label>
          <SearchSelect
            value={clientId}
            onChange={setClientId}
            options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.city ?? undefined }))}
            placeholder="Escolha o cliente"
            searchPlaceholder="Nome do cliente"
          />
        </div>
        <div className="w-full space-y-1 sm:w-64">
          <Label htmlFor="release-search">Colaborador</Label>
          <Input id="release-search" placeholder="Nome ou matrícula" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="release-pending" className="block">Só pendentes</Label>
          <div className="flex h-10 items-center"><Switch id="release-pending" checked={onlyPending} onCheckedChange={setOnlyPending} /></div>
        </div>
        {clientId && (
          <Button variant="outline" onClick={() => void copyNameList(`Liberação ${client?.name ?? ""}`, rows.map((r) => r.person.full_name))}>
            <Copy className="h-4 w-4" /> Copiar nomes
          </Button>
        )}
      </div>

      {!clientId ? (
        <p className="text-sm text-muted-foreground">Escolha um cliente para ver quem está liberado.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {rows.length} de {total} colaboradores ativos{onlyPending ? " com pendência" : ""}.{" "}
            {(required.data ?? []).length === 0 && "Este cliente não tem treinamentos exigidos no cadastro (Clientes › editar › Treinamentos exigidos). "}
            {client?.requires_integration === false && "Este cliente não exige integração."}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>ASO</TableHead>
                  {(required.data ?? []).map((t) => <TableHead key={t.id}>{t.label}</TableHead>)}
                  {client?.requires_integration !== false && <TableHead>Integração</TableHead>}
                  <TableHead>Novos Clientes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4 + (required.data ?? []).length} className="py-6 text-center text-sm text-muted-foreground">
                      {onlyPending ? "Ninguém com pendência neste cliente." : "Nenhum colaborador encontrado."}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.person.id}>
                    <TableCell className="whitespace-nowrap text-sm font-medium">
                      {r.person.full_name}
                      {r.person.registration_number && <span className="ml-1 text-xs text-muted-foreground">{r.person.registration_number}</span>}
                    </TableCell>
                    <TableCell>{cellView(r.aso, { type: "aso", collaboratorId: r.person.id })}</TableCell>
                    {r.trn.map((c, i) => (
                      <TableCell key={required.data![i]!.id}>{cellView(c, { type: "treinamento", collaboratorId: r.person.id, trainingId: required.data![i]!.id })}</TableCell>
                    ))}
                    {r.integration && <TableCell>{cellView(r.integration, { type: "integracao", collaboratorId: r.person.id, clientId })}</TableCell>}
                    <TableCell className="text-xs">
                      {r.onboarding ? (
                        <span className={cn("rounded px-1.5 py-0.5", r.onboarding === "pendente" ? TONE.expiring : r.onboarding === "liberado" ? TONE.valid : "text-muted-foreground")}>
                          {ONBOARDING_LABEL[r.onboarding] ?? r.onboarding}
                        </span>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {booking && (
        <AppointmentDialog
          key={booking.key}
          type={booking.type}
          open
          onOpenChange={(v) => { if (!v) setBooking(null); }}
          initialValues={{ collaborator_id: booking.collaboratorId, training_id: booking.trainingId ?? "", client_id: booking.clientId ?? "" }}
        />
      )}
    </div>
  );
}

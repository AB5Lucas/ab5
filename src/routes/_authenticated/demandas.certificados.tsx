import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, FileDown, Pencil, Plus, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  KIND_LABEL,
  attendancePdf,
  brDate,
  buildPhrase,
  certificatesPdf,
  classifyKind,
  formatCpf,
  openPdf,
  type CertKind,
  type CertSnapshot,
  type ListSnapshot,
} from "@/lib/certificates";

export const Route = createFileRoute("/_authenticated/demandas/certificados")({
  head: () => ({
    meta: [
      { title: "Certificados | AB5 Hub" },
      { name: "description", content: "Geração de certificados e listas de presença dos treinamentos." },
      { property: "og:title", content: "Certificados | AB5 Hub" },
      { property: "og:description", content: "Certificados e listas de presença a partir dos treinamentos realizados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CertificatesPage,
});

type CertData = {
  training_id: string;
  code: string | null;
  subject: string | null;
  workload_hours: number | null;
  workload_hours_periodic: number | null;
  training_title: string | null;
  schedule_text: string | null;
  cert_phrase: string | null;
  legal_basis: string | null;
  program: string | null;
  objectives: string | null;
  norms: string | null;
  default_location: string | null;
};
type Tst = {
  id: string;
  full_name: string;
  cpf: string | null;
  registration: string | null;
  council: string | null;
  role_title: string | null;
  company: string | null;
  active: boolean;
  notes: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const tstTitle = (t: Tst) => [t.role_title, t.council, t.registration].filter(Boolean).join(" ");

function useBase() {
  const trainings = useQuery({
    queryKey: ["cert-trainings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trainings").select("id, name, active, description").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const certData = useQuery({
    queryKey: ["cert-data"],
    queryFn: async () => {
      const { data, error } = await supabase.from("training_cert_data").select("*");
      if (error) throw error;
      return new Map((data ?? []).map((d) => [d.training_id, d as CertData]));
    },
  });
  const tsts = useQuery({
    queryKey: ["tsts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tst_instructors").select("*").order("full_name");
      if (error) throw error;
      return (data ?? []) as Tst[];
    },
  });
  return { trainings, certData, tsts };
}

/** Treinamentos realizados no dia (registros de Treinamentos), agrupados. */
function useDay(date: string) {
  return useQuery({
    queryKey: ["cert-day", date],
    enabled: !!date,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collaborator_trainings")
        .select("id, collaborator_id, training_id, completed_at, collaborators(full_name, cpf, registration_number), trainings(name)")
        .eq("completed_at", date);
      if (error) throw error;
      const rows = data ?? [];
      const ids = [...new Set(rows.map((r) => r.collaborator_id))];
      const { data: hist } = ids.length
        ? await supabase.from("collaborator_trainings").select("collaborator_id, training_id, completed_at").in("collaborator_id", ids)
        : { data: [] };
      const groups = new Map<string, { trainingId: string; name: string; people: { collabId: string; name: string; cpf: string | null; reg: string | null; kind: CertKind }[] }>();
      const seen = new Set<string>();
      for (const r of rows) {
        const key = r.collaborator_id + r.training_id;
        if (seen.has(key)) continue;
        seen.add(key);
        const dates = (hist ?? [])
          .filter((h) => h.collaborator_id === r.collaborator_id && h.training_id === r.training_id && h.completed_at)
          .map((h) => h.completed_at as string);
        const g = groups.get(r.training_id) ?? { trainingId: r.training_id, name: r.trainings?.name ?? "—", people: [] };
        g.people.push({
          collabId: r.collaborator_id,
          name: (r.collaborators?.full_name ?? "").toUpperCase(),
          cpf: r.collaborators?.cpf ?? null,
          reg: r.collaborators?.registration_number ?? null,
          kind: classifyKind(dates, date),
        });
        groups.set(r.training_id, g);
      }
      return [...groups.values()]
        .map((g) => ({ ...g, people: g.people.sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

function CertificatesPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Certificados" description="Certificados e listas de presença a partir dos treinamentos registrados." />
      <Tabs defaultValue="gerar">
        <TabsList>
          <TabsTrigger value="gerar">Gerar Certificados</TabsTrigger>
          <TabsTrigger value="lista">Lista de Presença</TabsTrigger>
          <TabsTrigger value="dados">Dados dos Treinamentos</TabsTrigger>
          <TabsTrigger value="tst">Cadastro de TSTs</TabsTrigger>
        </TabsList>
        <TabsContent value="gerar"><GenerateTab /></TabsContent>
        <TabsContent value="lista"><AttendanceTab /></TabsContent>
        <TabsContent value="dados"><TrainingDataTab /></TabsContent>
        <TabsContent value="tst"><TstTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function GenerateTab() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const { certData, tsts } = useBase();
  const day = useDay(date);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [tstBy, setTstBy] = useState<Record<string, string>>({});
  const [kindBy, setKindBy] = useState<Record<string, "inicial" | "renovacao">>({});
  const [split, setSplit] = useState(false);

  const issued = useQuery({
    queryKey: ["certs-issued", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_certificates")
        .select("*")
        .eq("training_date", date)
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeTsts = (tsts.data ?? []).filter((t) => t.active);
  const key = (t: string, c: string) => `${t}|${c}`;

  const selected = useMemo(() => {
    const out: { g: NonNullable<typeof day.data>[number]; p: NonNullable<typeof day.data>[number]["people"][number] }[] = [];
    (day.data ?? []).forEach((g) => g.people.forEach((p) => sel[key(g.trainingId, p.collabId)] && out.push({ g, p })));
    return out;
  }, [day.data, sel]);

  const pending: string[] = [];
  const snaps: { s: CertSnapshot; trainingId: string; collabId: string; tstId: string; kind: "inicial" | "renovacao"; manual: boolean }[] = [];
  for (const { g, p } of selected) {
    const cd = certData.data?.get(g.trainingId);
    const tst = activeTsts.find((t) => t.id === tstBy[g.trainingId]);
    const k = kindBy[key(g.trainingId, p.collabId)] ?? (p.kind === "conferir" ? undefined : p.kind);
    if (!cd?.cert_phrase || !cd.legal_basis || !cd.workload_hours || !cd.program)
      pending.push(`${g.name}: complete os dados do treinamento (frase, norma, carga horária e conteúdo)`);
    if (!tst) pending.push(`${g.name}: selecione o TST responsável`);
    if (!p.cpf) pending.push(`${p.name}: sem CPF no cadastro`);
    if (!k) pending.push(`${p.name} (${g.name}): defina se é Inicial ou Renovação`);
    if (cd && tst && k && p.cpf)
      snaps.push({
        trainingId: g.trainingId,
        collabId: p.collabId,
        tstId: tst.id,
        kind: k,
        manual: !!kindBy[key(g.trainingId, p.collabId)] && kindBy[key(g.trainingId, p.collabId)] !== p.kind,
        s: {
          name: p.name,
          cpf: formatCpf(p.cpf),
          registration: p.reg,
          trainingName: g.name,
          subject: cd.subject ?? g.name,
          kind: k,
          phrase: buildPhrase(cd.cert_phrase ?? "", k),
          legalBasis: cd.legal_basis ?? "",
          hours: Number((k === "renovacao" ? cd.workload_hours_periodic ?? cd.workload_hours : cd.workload_hours) ?? 0),
          date,
          location: cd.default_location ?? "Mogi Guaçu",
          program: cd.program ?? "",
          tstName: tst.full_name.toUpperCase(),
          tstTitle: tstTitle(tst),
        },
      });
  }
  const uniquePending = [...new Set(pending)];

  const emit = async (list: CertSnapshot[]) => {
    if (split) {
      for (const s of list) {
        const { doc } = await certificatesPdf([s], "");
        doc.save(`Certificado ${s.trainingName} - ${s.name}.pdf`);
      }
    } else {
      const { doc } = await certificatesPdf(list, "");
      openPdf(doc);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      const dup = snaps.filter((x) => (issued.data ?? []).some((i) => i.collaborator_id === x.collabId && i.training_id === x.trainingId));
      if (dup.length && !window.confirm(`${dup.length} certificado(s) já foram emitidos nesta data. Emitir nova versão?`)) return false;
      const rows = snaps.map((x) => {
        const prev = (issued.data ?? []).filter((i) => i.collaborator_id === x.collabId && i.training_id === x.trainingId);
        return {
          collaborator_id: x.collabId,
          training_id: x.trainingId,
          training_date: date,
          tst_id: x.tstId,
          kind: x.kind,
          kind_manual: x.manual,
          version: prev.length + 1,
          snapshot: x.s as never,
        };
      });
      const { error } = await supabase.from("training_certificates").insert(rows);
      if (error) throw error;
      await emit(snaps.map((x) => x.s));
      return true;
    },
    onSuccess: (ok) => {
      if (ok) toast.success("Certificados emitidos");
      qc.invalidateQueries({ queryKey: ["certs-issued"] });
    },
    onError: (e: Error) => toast.error("Não foi possível emitir: " + e.message),
  });

  const reissue = useMutation({
    mutationFn: async (c: NonNullable<typeof issued.data>[number]) => {
      const n = (issued.data ?? []).filter((i) => i.collaborator_id === c.collaborator_id && i.training_id === c.training_id).length;
      const { error } = await supabase.from("training_certificates").insert({
        collaborator_id: c.collaborator_id,
        training_id: c.training_id,
        training_date: c.training_date,
        tst_id: c.tst_id,
        kind: c.kind,
        kind_manual: c.kind_manual,
        version: n + 1,
        snapshot: c.snapshot,
      });
      if (error) throw error;
      const { doc } = await certificatesPdf([c.snapshot as unknown as CertSnapshot], "");
      openPdf(doc);
    },
    onSuccess: () => {
      toast.success("Certificado reemitido");
      qc.invalidateQueries({ queryKey: ["certs-issued"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allKeys = (day.data ?? []).flatMap((g) => g.people.map((p) => key(g.trainingId, p.collabId)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Data do treinamento</Label>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSel({}); }} className="w-44" />
        </div>
        {allKeys.length > 0 && (
          <Button variant="outline" onClick={() => setSel(Object.fromEntries(allKeys.map((k) => [k, true])))}>
            Selecionar todos do dia
          </Button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={split} onCheckedChange={setSplit} /> Um PDF por colaborador
        </label>
      </div>

      {day.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {day.data && day.data.length === 0 && (
        <p className="rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">
          Nenhum treinamento registrado em {brDate(date)}.
        </p>
      )}

      {(day.data ?? []).map((g) => {
        const all = g.people.every((p) => sel[key(g.trainingId, p.collabId)]);
        return (
          <div key={g.trainingId} className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <Checkbox
                checked={all}
                onCheckedChange={(v) =>
                  setSel((s) => ({ ...s, ...Object.fromEntries(g.people.map((p) => [key(g.trainingId, p.collabId), !!v])) }))
                }
              />
              <span className="font-semibold">{g.name}</span>
              <Badge variant="secondary">{g.people.length} pessoa(s)</Badge>
              <span className="text-xs text-muted-foreground">
                Carga horária: {certData.data?.get(g.trainingId)?.workload_hours ?? "—"} h
              </span>
              <div className="ml-auto w-64">
                <Select value={tstBy[g.trainingId] ?? ""} onValueChange={(v) => setTstBy((s) => ({ ...s, [g.trainingId]: v }))}>
                  <SelectTrigger><SelectValue placeholder="TST responsável" /></SelectTrigger>
                  <SelectContent>
                    {activeTsts.map((t) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Matrícula</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.people.map((p) => {
                  const k = key(g.trainingId, p.collabId);
                  const n = (issued.data ?? []).filter((i) => i.collaborator_id === p.collabId && i.training_id === g.trainingId).length;
                  return (
                    <TableRow key={k}>
                      <TableCell><Checkbox checked={!!sel[k]} onCheckedChange={(v) => setSel((s) => ({ ...s, [k]: !!v }))} /></TableCell>
                      <TableCell>{p.reg ?? "—"}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.cpf ? formatCpf(p.cpf) : <span className="text-destructive">sem CPF</span>}</TableCell>
                      <TableCell>
                        <Select value={kindBy[k] ?? (p.kind === "conferir" ? "" : p.kind)} onValueChange={(v) => setKindBy((s) => ({ ...s, [k]: v as "inicial" | "renovacao" }))}>
                          <SelectTrigger className={`h-8 w-36 ${p.kind === "conferir" && !kindBy[k] ? "border-destructive" : ""}`}>
                            <SelectValue placeholder={KIND_LABEL.conferir} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inicial">Inicial</SelectItem>
                            <SelectItem value="renovacao">Renovação</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{n ? <Badge>Emitido{n > 1 ? ` (${n}x)` : ""}</Badge> : <Badge variant="outline">Pendente</Badge>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        );
      })}

      {selected.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          {uniquePending.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {uniquePending.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={!snaps.length} onClick={async () => openPdf((await certificatesPdf(snaps.map((x) => x.s), "")).doc)}>
              <Eye className="h-4 w-4" /> Pré-visualizar
            </Button>
            <Button disabled={uniquePending.length > 0 || save.isPending} onClick={() => save.mutate()}>
              <FileDown className="h-4 w-4" /> Emitir {selected.length} certificado(s)
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 font-semibold">Certificados emitidos em {brDate(date)}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Treinamento</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>TST</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Emitido em</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(issued.data ?? []).length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhum certificado emitido.</TableCell></TableRow>
            )}
            {(issued.data ?? []).map((c) => {
              const s = c.snapshot as unknown as CertSnapshot;
              return (
                <TableRow key={c.id}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.trainingName}</TableCell>
                  <TableCell>{KIND_LABEL[c.kind as CertKind]}{c.kind_manual && <span className="ml-1 text-xs text-muted-foreground">(ajuste manual)</span>}</TableCell>
                  <TableCell>{s.tstName}</TableCell>
                  <TableCell>{c.version}</TableCell>
                  <TableCell>{new Date(c.issued_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Ver" onClick={async () => openPdf((await certificatesPdf([s], "")).doc)}><Eye className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Reemitir" onClick={() => reissue.mutate(c)}><RefreshCw className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AttendanceTab() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const { certData, tsts } = useBase();
  const day = useDay(date);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [tstBy, setTstBy] = useState<Record<string, string>>({});
  const activeTsts = (tsts.data ?? []).filter((t) => t.active);

  const lists = useQuery({
    queryKey: ["att-lists", date],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance_lists").select("*").eq("training_date", date).order("issued_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const chosen = (day.data ?? []).filter((g) => sel[g.trainingId]);
  const missing = chosen.filter((g) => !tstBy[g.trainingId]).map((g) => g.name);

  const gen = useMutation({
    mutationFn: async () => {
      const snaps: { trainingId: string; tstId: string; s: ListSnapshot }[] = chosen.map((g) => {
        const cd = certData.data?.get(g.trainingId);
        const t = activeTsts.find((x) => x.id === tstBy[g.trainingId])!;
        return {
          trainingId: g.trainingId,
          tstId: t.id,
          s: {
            subject: cd?.subject ?? g.name.toUpperCase(),
            tstName: t.full_name.toUpperCase(),
            date,
            schedule: cd?.schedule_text ?? "",
            hours: Number(cd?.workload_hours ?? 0),
            people: g.people.map((p) => ({ name: p.name, cpf: formatCpf(p.cpf) })),
          },
        };
      });
      const { error } = await supabase.from("attendance_lists").insert(
        snaps.map((x) => ({
          training_id: x.trainingId,
          training_date: date,
          tst_id: x.tstId,
          version: (lists.data ?? []).filter((l) => l.training_id === x.trainingId).length + 1,
          snapshot: x.s as never,
        })),
      );
      if (error) throw error;
      openPdf(await attendancePdf(snaps.map((x) => x.s)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["att-lists"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Data do treinamento</Label>
        <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSel({}); }} className="w-44" />
      </div>
      {day.data && day.data.length === 0 && (
        <p className="rounded-md border border-border bg-secondary p-3 text-sm text-muted-foreground">Nenhum treinamento registrado em {brDate(date)}.</p>
      )}
      {(day.data ?? []).map((g) => (
        <div key={g.trainingId} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
          <Checkbox checked={!!sel[g.trainingId]} onCheckedChange={(v) => setSel((s) => ({ ...s, [g.trainingId]: !!v }))} />
          <span className="font-semibold">{g.name}</span>
          <Badge variant="secondary">{g.people.length} participante(s)</Badge>
          <div className="ml-auto w-64">
            <Select value={tstBy[g.trainingId] ?? ""} onValueChange={(v) => setTstBy((s) => ({ ...s, [g.trainingId]: v }))}>
              <SelectTrigger><SelectValue placeholder="Instrutor / TST" /></SelectTrigger>
              <SelectContent>{activeTsts.map((t) => <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      ))}
      {chosen.length > 0 && (
        <div className="flex items-center gap-3">
          <Button disabled={missing.length > 0 || gen.isPending} onClick={() => gen.mutate()}>
            <FileDown className="h-4 w-4" /> Gerar {chosen.length} lista(s)
          </Button>
          {missing.length > 0 && <span className="text-sm text-destructive">Selecione o instrutor de: {missing.join(", ")}</span>}
        </div>
      )}
      <div className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 font-semibold">Listas geradas em {brDate(date)}</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Assunto</TableHead>
              <TableHead>Instrutor</TableHead>
              <TableHead>Participantes</TableHead>
              <TableHead>Versão</TableHead>
              <TableHead>Gerada em</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(lists.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Nenhuma lista gerada.</TableCell></TableRow>}
            {(lists.data ?? []).map((l) => {
              const s = l.snapshot as unknown as ListSnapshot;
              return (
                <TableRow key={l.id}>
                  <TableCell>{s.subject}</TableCell>
                  <TableCell>{s.tstName}</TableCell>
                  <TableCell>{s.people.length}</TableCell>
                  <TableCell>{l.version}</TableCell>
                  <TableCell>{new Date(l.issued_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" aria-label="Ver" onClick={async () => openPdf(await attendancePdf([s]))}><Eye className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const DATA_FIELDS: { k: keyof CertData; label: string; area?: boolean; hint?: string }[] = [
  { k: "code", label: "Código / referência" },
  { k: "subject", label: "Assunto (lista de presença)", hint: "Ex.: NR 33 - ESPAÇO CONFINADO" },
  { k: "workload_hours", label: "Carga horária Inicial (horas)" },
  { k: "workload_hours_periodic", label: "Carga horária Periódico (horas)" },
  { k: "schedule_text", label: "Horário", hint: "Ex.: 08:00 às 17:00" },
  { k: "default_location", label: "Local" },
  { k: "cert_phrase", label: "Frase do certificado", area: true, hint: "Use {tipo} para Inicial/Periódico." },
  { k: "legal_basis", label: "Conforme estabelece", hint: "Ex.: a NR 33 da MTP n.º 672, de 08 de Novembro de 2021" },
  { k: "norms", label: "Normas regulamentadoras" },
  { k: "objectives", label: "Objetivos", area: true },
  { k: "program", label: "Conteúdo programático (uma linha por item)", area: true },
];

function TrainingDataTab() {
  const qc = useQueryClient();
  const { trainings, certData } = useBase();
  const [edit, setEdit] = useState<{ id: string; name: string; form: Partial<CertData> } | null>(null);
  const missing = (d?: CertData) =>
    !d ? ["todos"] : (["cert_phrase", "legal_basis", "workload_hours", "program"] as const).filter((k) => !d[k]);

  const save = useMutation({
    mutationFn: async () => {
      if (!edit) return;
      const f = edit.form;
      const { error } = await supabase.from("training_cert_data").upsert({
        training_id: edit.id,
        code: f.code || null,
        subject: f.subject || null,
        workload_hours: f.workload_hours ? Number(f.workload_hours) : null,
        workload_hours_periodic: f.workload_hours_periodic ? Number(f.workload_hours_periodic) : null,
        training_title: f.training_title || null,
        schedule_text: f.schedule_text || null,
        cert_phrase: f.cert_phrase || null,
        legal_basis: f.legal_basis || null,
        program: f.program || null,
        objectives: f.objectives || null,
        norms: f.norms || null,
        default_location: f.default_location || null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados salvos");
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["cert-data"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>NR</TableHead>
            <TableHead>Treinamento</TableHead>
            <TableHead>Carga horária</TableHead>
            <TableHead>Pendências para emissão</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(trainings.data ?? []).filter((t) => t.active).map((t) => {
            const d = certData.data?.get(t.id);
            const m = missing(d);
            return (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{(t as { description?: string | null }).description || "—"}</TableCell>
                <TableCell>{d?.workload_hours || d?.workload_hours_periodic ? `Inicial ${d?.workload_hours ?? "—"} h / Periódico ${d?.workload_hours_periodic ?? "—"} h` : "—"}</TableCell>
                <TableCell>{m.length ? <Badge variant="outline" className="text-destructive">Incompleto</Badge> : <Badge>Pronto</Badge>}</TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit({ id: t.id, name: t.name, form: { ...(d ?? {}) } })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{edit?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {DATA_FIELDS.map((f) => (
              <div key={f.k}>
                <Label>{f.label}</Label>
                {f.area ? (
                  <Textarea rows={f.k === "program" ? 8 : 3} value={String(edit?.form[f.k] ?? "")} placeholder={f.hint} onChange={(e) => setEdit((s) => s && { ...s, form: { ...s.form, [f.k]: e.target.value } })} />
                ) : (
                  <Input type={f.k === "workload_hours" || f.k === "workload_hours_periodic" ? "number" : "text"} value={String(edit?.form[f.k] ?? "")} placeholder={f.hint} onChange={(e) => setEdit((s) => s && { ...s, form: { ...s.form, [f.k]: e.target.value } })} />
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Alterações valem só para as próximas emissões; certificados já emitidos não mudam.</p>
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TstTab() {
  const qc = useQueryClient();
  const { tsts } = useBase();
  const [edit, setEdit] = useState<Partial<Tst> | null>(null);
  const counts = useQuery({
    queryKey: ["tst-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("training_certificates").select("tst_id");
      const m = new Map<string, number>();
      (data ?? []).forEach((r) => r.tst_id && m.set(r.tst_id, (m.get(r.tst_id) ?? 0) + 1));
      return m;
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!edit?.full_name?.trim()) throw new Error("Informe o nome");
      const row = {
        full_name: edit.full_name.trim(),
        cpf: edit.cpf || null,
        registration: edit.registration || null,
        council: edit.council || null,
        role_title: edit.role_title || null,
        company: edit.company || null,
        notes: edit.notes || null,
        active: edit.active ?? true,
      };
      const { error } = edit.id
        ? await supabase.from("tst_instructors").update(row).eq("id", edit.id)
        : await supabase.from("tst_instructors").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["tsts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: async (t: Tst) => {
      const { error } = await supabase.from("tst_instructors").update({ active: !t.active }).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tsts"] }),
  });
  const F: { k: keyof Tst; label: string }[] = [
    { k: "full_name", label: "Nome completo" },
    { k: "cpf", label: "CPF" },
    { k: "registration", label: "Registro profissional" },
    { k: "council", label: "Órgão / conselho (ex.: MTE)" },
    { k: "role_title", label: "Cargo / função" },
    { k: "company", label: "Empresa / unidade" },
    { k: "notes", label: "Informações complementares" },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEdit({ role_title: "Téc. Seg. Trabalho", council: "MTE", active: true })}><Plus className="h-4 w-4" /> Novo TST</Button>
      <div className="rounded-lg border border-border bg-card p-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Certificados</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(tsts.data ?? []).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.full_name}</TableCell>
                <TableCell>{[t.council, t.registration].filter(Boolean).join(" ") || "—"}</TableCell>
                <TableCell>{t.role_title ?? "—"}</TableCell>
                <TableCell>{counts.data?.get(t.id) ?? 0}</TableCell>
                <TableCell><Switch checked={t.active} onCheckedChange={() => toggle.mutate(t)} /></TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEdit(t)}><Pencil className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit?.id ? "Editar TST" : "Novo TST"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {F.map((f) => (
              <div key={f.k}>
                <Label>{f.label}</Label>
                <Input value={String(edit?.[f.k] ?? "")} onChange={(e) => setEdit((s) => s && { ...s, [f.k]: e.target.value })} />
              </div>
            ))}
          </div>
          <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

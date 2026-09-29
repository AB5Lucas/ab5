import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays, formatDateBR, todayISO, INTEGRATION_WARN_DAYS } from "@/lib/scheduling";

export const Route = createFileRoute("/_authenticated/consulta")({
  head: () => ({
    meta: [
      { title: "Consulta de Vencimentos | AB5 Hub" },
      { name: "description", content: "Consulte vencimentos de ASO, treinamentos e integrações por colaborador ou cliente." },
      { property: "og:title", content: "Consulta de Vencimentos | AB5 Hub" },
      { property: "og:description", content: "Vencimentos por colaborador e colaboradores liberados por cliente." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConsultaPage,
});

type St = "valid" | "expiring" | "expired" | "missing";
const DOT: Record<St, string> = {
  valid: "bg-green-500",
  expiring: "bg-yellow-400",
  expired: "bg-red-600",
  missing: "bg-muted-foreground/40",
};
const LABEL: Record<St, string> = { valid: "Válido", expiring: "Próximo do vencimento", expired: "Vencido", missing: "Não possui" };

function statusOf(exp: string | null | undefined, today: string, hasRecord = true): St {
  if (!hasRecord) return "missing";
  if (!exp) return "valid";
  if (exp < today) return "expired";
  if (exp <= addDays(today, INTEGRATION_WARN_DAYS)) return "expiring";
  return "valid";
}

async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(table as any) as any).select(cols).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Collab = { id: string; full_name: string; registration_number: string; status: string };
type Rec = { collaborator_id: string; expires_at: string | null };

function useData() {
  return useQuery({
    queryKey: ["consulta-data"],
    queryFn: async () => {
      const [collabs, clients, trainings, asos, ct, ci] = await Promise.all([
        fetchAll<Collab>("collaborators", "id, full_name, registration_number, status"),
        fetchAll<{ id: string; name: string; active: boolean; requires_integration: boolean }>("clients", "id, name, active, requires_integration"),
        fetchAll<{ id: string; name: string }>("trainings", "id, name"),
        fetchAll<Rec & { exam_date: string }>("asos", "collaborator_id, exam_date, expires_at"),
        fetchAll<Rec & { training_id: string; completed_at: string }>("collaborator_trainings", "collaborator_id, training_id, completed_at, expires_at"),
        fetchAll<Rec & { client_id: string; integration_date: string }>("client_integrations", "collaborator_id, client_id, integration_date, expires_at"),
      ]);
      return {
        collabs: collabs.filter((c) => c.status === "active").sort((a, b) => a.full_name.localeCompare(b.full_name)),
        clients: clients.sort((a, b) => a.name.localeCompare(b.name)),
        trainings, asos, ct, ci,
      };
    },
  });
}

/** Keep only the record with the latest expiry per key. */
function latestBy<T extends { expires_at: string | null }>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T>();
  rows.forEach((r) => {
    const k = key(r);
    const cur = m.get(k);
    if (!cur || (r.expires_at ?? "9999") > (cur.expires_at ?? "9999")) m.set(k, r);
  });
  return m;
}

function Dot({ s }: { s: St }) {
  return <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${DOT[s]}`} title={LABEL[s]} />;
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {(["valid", "expiring", "expired"] as St[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5"><Dot s={s} />{LABEL[s]}</span>
      ))}
    </div>
  );
}

function ConsultaPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Consulta" description="Vencimentos por colaborador e colaboradores liberados por cliente." />
      <Tabs defaultValue="colab">
        <TabsList>
          <TabsTrigger value="colab">Por colaborador</TabsTrigger>
          <TabsTrigger value="client">Por cliente</TabsTrigger>
        </TabsList>
        <TabsContent value="colab"><ByCollaborator /></TabsContent>
        <TabsContent value="client"><ByClient /></TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ s, name, done, exp }: { s: St; name: string; done?: string | null; exp?: string | null }) {
  return (
    <div className="flex items-center gap-3 border-b py-2 text-sm last:border-0">
      <Dot s={s} />
      <span className="flex-1 font-medium">{name}</span>
      <span className="w-28 text-muted-foreground">{done ? formatDateBR(done) : "—"}</span>
      <span className="w-28">{s === "missing" ? "Não possui" : exp ? formatDateBR(exp) : "Sem validade"}</span>
    </div>
  );
}

function Section({ title, children, empty }: { title: string; children: React.ReactNode; empty: boolean }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-3 text-xs font-semibold uppercase text-muted-foreground">
        <span className="w-3" /><span className="flex-1">{title}</span><span className="w-28">Realização</span><span className="w-28">Vencimento</span>
      </div>
      {empty ? <p className="py-2 text-sm text-muted-foreground">Nenhum registro.</p> : children}
    </Card>
  );
}

function ByCollaborator() {
  const { data, isLoading } = useData();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const today = todayISO();

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!data || t.length < 2) return [];
    return data.collabs.filter((c) => c.full_name.toLowerCase().includes(t) || c.registration_number?.toLowerCase().includes(t)).slice(0, 20);
  }, [data, q]);

  const person = data?.collabs.find((c) => c.id === sel);

  const info = useMemo(() => {
    if (!data || !sel) return null;
    const aso = latestBy(data.asos.filter((a) => a.collaborator_id === sel), () => "x").get("x");
    const tr = [...latestBy(data.ct.filter((r) => r.collaborator_id === sel), (r) => r.training_id).values()]
      .map((r) => ({ ...r, name: data.trainings.find((t) => t.id === r.training_id)?.name ?? "Treinamento" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const ig = [...latestBy(data.ci.filter((r) => r.collaborator_id === sel), (r) => r.client_id).values()]
      .map((r) => ({ ...r, name: data.clients.find((c) => c.id === r.client_id)?.name ?? "Cliente" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { aso, tr, ig };
  }, [data, sel]);

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <Input placeholder={isLoading ? "Carregando..." : "Digite o nome ou matrícula do colaborador"} value={q}
          onChange={(e) => { setQ(e.target.value); setSel(null); }} />
        {!sel && matches.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-md border">
            {matches.map((c) => (
              <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => { setSel(c.id); setQ(c.full_name); }}>
                {c.full_name} <span className="text-muted-foreground">· {c.registration_number}</span>
              </button>
            ))}
          </div>
        )}
        <Legend />
      </Card>
      {person && info && (
        <>
          <h2 className="text-lg font-semibold">{person.full_name}</h2>
          <Section title="ASO" empty={false}>
            <Row s={statusOf(info.aso?.expires_at, today, !!info.aso)} name="ASO" done={info.aso?.exam_date} exp={info.aso?.expires_at} />
          </Section>
          <Section title="Treinamentos" empty={info.tr.length === 0}>
            {info.tr.map((r) => <Row key={r.training_id} s={statusOf(r.expires_at, today)} name={r.name} done={r.completed_at} exp={r.expires_at} />)}
          </Section>
          <Section title="Integrações" empty={info.ig.length === 0}>
            {info.ig.map((r) => <Row key={r.client_id} s={statusOf(r.expires_at, today)} name={r.name} done={r.integration_date} exp={r.expires_at} />)}
          </Section>
        </>
      )}
    </div>
  );
}

function ByClient() {
  const { data, isLoading } = useData();
  const [clientId, setClientId] = useState("");
  const [filter, setFilter] = useState<"all" | St>("all");
  const today = todayISO();

  const rows = useMemo(() => {
    if (!data || !clientId) return [];
    const active = new Set(data.collabs.map((c) => c.id));
    const asoMap = latestBy(data.asos, (a) => a.collaborator_id);
    return [...latestBy(data.ci.filter((r) => r.client_id === clientId && active.has(r.collaborator_id)), (r) => r.collaborator_id).values()]
      .map((r) => {
        const c = data.collabs.find((x) => x.id === r.collaborator_id)!;
        const aso = asoMap.get(r.collaborator_id);
        return { ...r, name: c.full_name, s: statusOf(r.expires_at, today), asoS: statusOf(aso?.expires_at, today, !!aso), asoExp: aso?.expires_at };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, clientId, today]);

  const shown = filter === "all" ? rows : rows.filter((r) => r.s === filter);
  const count = (s: St) => rows.filter((r) => r.s === s).length;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-3">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="w-72"><SelectValue placeholder={isLoading ? "Carregando..." : "Selecione o cliente"} /></SelectTrigger>
            <SelectContent>
              {data?.clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.active ? "" : " (inativo)"}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filter} onValueChange={(v) => setFilter(v as "all" | St)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="valid">Válidos</SelectItem>
              <SelectItem value="expiring">Próximos do vencimento</SelectItem>
              <SelectItem value="expired">Vencidos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {clientId && (
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5"><Dot s="valid" />{count("valid")} liberados</span>
            <span className="flex items-center gap-1.5"><Dot s="expiring" />{count("expiring")} próximos do vencimento</span>
            <span className="flex items-center gap-1.5"><Dot s="expired" />{count("expired")} vencidos</span>
          </div>
        )}
      </Card>
      {clientId && (
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-3 text-xs font-semibold uppercase text-muted-foreground">
            <span className="w-3" /><span className="flex-1">Colaborador</span><span className="w-28">Integração</span><span className="w-28">Vencimento</span><span className="w-32">ASO</span>
          </div>
          {shown.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Nenhum colaborador.</p> : shown.map((r) => (
            <div key={r.collaborator_id} className="flex items-center gap-3 border-b py-2 text-sm last:border-0">
              <Dot s={r.s} />
              <span className="flex-1 font-medium">{r.name}</span>
              <span className="w-28 text-muted-foreground">{formatDateBR(r.integration_date)}</span>
              <span className="w-28">{r.expires_at ? formatDateBR(r.expires_at) : "Sem validade"}</span>
              <span className="flex w-32 items-center gap-1.5"><Dot s={r.asoS} />{r.asoExp ? formatDateBR(r.asoExp) : "Não possui"}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

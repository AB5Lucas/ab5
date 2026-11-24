import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateClientImage } from "@/lib/client-images.functions";
import { aerialMosaic, geocode } from "@/lib/client-aerial";
import { ORIGIN_LABEL, type ImageOrigin } from "@/lib/client-images";
import { PastePrint } from "@/components/compras/paste-print";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Building2, ImagePlus, LayoutGrid, List, MapPin, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CadastrosTabs } from "@/components/cadastros-tabs";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tables } from "@/integrations/supabase/types";
import { ImportDialog, type ImportColumn, type ImportRow } from "@/components/import-dialog";
import { MultiFilter } from "@/components/multi-filter";
import { emptyToNull, insertSequentially, parseBool, parseNum, titleCase, titleCaseOrNull } from "@/lib/import-helpers";

type Client = Tables<"clients">;

const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "nome", required: true, example: "Enel" },
  { key: "endereco", example: "Rua das Palmeiras" },
  { key: "numero", example: "150" },
  { key: "bairro" },
  { key: "cidade", example: "Campinas" },
  { key: "uf", hint: "2 letras.", example: "SP" },
  { key: "cep", example: "13000-000" },
  { key: "distancia_km", hint: "Número, use vírgula ou ponto.", example: "85,5" },
  { key: "exige_integracao", hint: "sim ou nao. Em branco = sim.", example: "sim" },
  { key: "observacoes" },
];

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes | Programação Operacional" },
      { name: "description", content: "Cadastro de clientes: endereço, cidade, distância e observações." },
      { property: "og:title", content: "Clientes | Programação Operacional" },
      { property: "og:description", content: "Cadastro de clientes, endereços e distâncias." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientsPage,
});

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente").max(150),
  state: z.string().trim().max(2, "UF com 2 letras").optional().or(z.literal("")),
});

type FormState = {
  name: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  distance_km: string;
  notes: string;
  requires_integration: boolean;
  needs_company_transport: boolean;
  needs_transport_voucher: boolean;
  has_toll: boolean;
  toll_amount: string;
  trips_per_day: string;
  cc_prefix: string;
  manager_id: string;
  substitute_manager_id: string;
};

const NONE = "__none__";
const ref = (v: string) => (v === NONE ? null : v);

const emptyForm: FormState = {
  name: "",
  address: "",
  number: "",
  neighborhood: "",
  city: "",
  state: "",
  zip_code: "",
  distance_km: "",
  notes: "",
  requires_integration: true,
  needs_company_transport: false,
  needs_transport_voucher: false,
  has_toll: false,
  toll_amount: "",
  trips_per_day: "1",
  cc_prefix: "",
  manager_id: NONE,
  substitute_manager_id: NONE,
};

const nn = (v: string) => (v.trim() === "" ? null : v.trim());

function ClientsPage() {
  const { canWrite, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // Quadros (padrão) ou lista; lembrado neste navegador.
  const [view, setView] = useState<"cards" | "list">("cards");
  useEffect(() => { try { if (localStorage.getItem("clientes-view") === "list") setView("list"); } catch { /* ignora */ } }, []);
  const changeView = (v: "cards" | "list") => { setView(v); try { localStorage.setItem("clientes-view", v); } catch { /* ignora */ } };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [addressSource, setAddressSource] = useState("");
  // Foto de referência do cliente (colada ou link): a imagem do quadro é feita a partir dela.
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refLink, setRefLink] = useState("");
  const [deleting, setDeleting] = useState<Client | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  /** Treinamentos exigidos pelo cliente (client_required_trainings): bloqueiam a escalação na Programação. */
  const [reqTrainings, setReqTrainings] = useState<string[]>([]);

  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
  // Imagem da fachada gerada pela IA (mesmo estilo para todos): uma por vez, para não estourar o limite da IA.
  const genImage = useServerFn(generateClientImage);
  const [genIds, setGenIds] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  // Sem foto de referência nem busca do Google, o navegador monta a vista aérea do satélite e grava como fonte.
  const runGen = async (id: string) => {
    setGenIds((s) => new Set(s).add(id));
    try {
      let res = await genImage({ data: { clientId: id } });
      if (res.needAerial) {
        const c = (clients.data ?? []).find((x) => x.id === id);
        if (!c) throw new Error("Cliente não encontrado");
        const geo = await geocode(c);
        if (!geo) throw new Error(`Endereço de ${c.name} não localizado no mapa: cole uma foto de referência no cadastro.`);
        const blob = await aerialMosaic(geo.lat, geo.lon);
        const path = `src/${id}-aerea-${Date.now()}.jpg`;
        const up = await supabase.storage.from("client-images").upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (up.error) throw up.error;
        const { error } = await supabase.from("clients").update({ image_source: path, image_source_kind: "aerea" }).eq("id", id);
        if (error) throw error;
        res = await genImage({ data: { clientId: id } });
      }
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      return true;
    }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setGenIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  };
  // Faltando = sem imagem ou feita pelo modo antigo (inventada, sem origem real).
  const needsImage = (c: { image_path: string | null; image_origin: string | null }) => !c.image_path || !c.image_origin;
  const genMissing = async (auto = false) => {
    const list = (clients.data ?? []).filter(needsImage);
    if (!list.length) { if (!auto) toast.info("Todos os clientes já têm imagem"); return; }
    setBulk({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) { await runGen(list[i]!.id); setBulk({ done: i + 1, total: list.length }); }
    setBulk(null);
  };
  // Automático: cliente novo ou com foto de referência nova gera na hora; ao abrir a página, gera as que faltam (uma vez).
  const pendingGen = useRef(new Set<string>());
  const autoRan = useRef(false);
  useEffect(() => {
    if (!canWrite || !clients.data || bulk) return;
    const pend = [...pendingGen.current].filter((id) => (clients.data ?? []).some((c) => c.id === id && needsImage(c)));
    pendingGen.current.clear();
    if (pend.length) { void (async () => { for (const id of pend) await runGen(id); })(); return; }
    if (!autoRan.current) { autoRan.current = true; void genMissing(true); }
  }, [clients.data, canWrite]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useQuery({
    queryKey: ["collaborators-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("id, full_name").eq("status", "active").order("full_name");
      if (error) throw error;
      return data;
    },
  });
  const trainings = useQuery({
    queryKey: ["trainings-active-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("trainings").select("id, name, description").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });
  const trainingOptions = useMemo(
    () => (trainings.data ?? []).map((t) => ({ value: t.id, label: t.description ? `${t.name} — ${t.description}` : t.name })),
    [trainings.data],
  );
  const required = useQuery({
    queryKey: ["client-required-trainings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("client_required_trainings").select("client_id, training_id");
      if (error) throw error;
      return data;
    },
  });
  const requiredBy = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of required.data ?? []) m.set(r.client_id, [...(m.get(r.client_id) ?? []), r.training_id]);
    return m;
  }, [required.data]);

  const nameById = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name])), [people.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.data ?? [];
    return (clients.data ?? []).filter((c) =>
      [c.name, c.city, c.neighborhood].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [clients.data, search]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = schema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      if (form.cc_prefix.trim() && !/^\d{4}$/.test(form.cc_prefix.trim())) throw new Error("Prefixo CC deve ter 4 números");
      const payload = {
        name: form.name.trim(),
        address: nn(form.address),
        number: nn(form.number),
        neighborhood: nn(form.neighborhood),
        city: nn(form.city),
        state: nn(form.state)?.toUpperCase() ?? null,
        zip_code: nn(form.zip_code),
        distance_km: form.distance_km.trim() === "" ? null : Number(form.distance_km),
        notes: nn(form.notes),
        requires_integration: form.requires_integration,
        needs_company_transport: form.needs_company_transport,
        needs_transport_voucher: form.needs_transport_voucher,
        has_toll: form.has_toll,
        toll_amount: form.has_toll ? Number(form.toll_amount.replace(",", ".")) || 0 : 0,
        trips_per_day: Math.max(1, Number(form.trips_per_day) || 1),
        cc_prefix: nn(form.cc_prefix),
        manager_id: ref(form.manager_id),
        substitute_manager_id: ref(form.substitute_manager_id),
      };
      let clientId = editing?.id ?? null;
      if (editing) {
        const { error } = await supabase.from("clients").update(payload).eq("id", editing.id);
        if (error) throw error;
        if (Number(editing.distance_km ?? 0) !== Number(payload.distance_km ?? 0)) {
          await supabase
            .from("vehicle_schedules")
            .update({ km: Number(payload.distance_km ?? 0) })
            .eq("client_id", editing.id)
            .eq("is_external", false)
            .eq("is_maintenance", false)
            .eq("is_suzano_local", false)
            .is("external_place", null); // Indústria com local mantém os 100 km fixos
          queryClient.invalidateQueries({ queryKey: ["vehicle-schedules"] });
          queryClient.invalidateQueries({ queryKey: ["km-report"] });
        }
      } else {
        const { data, error } = await supabase.from("clients").insert(payload).select("id").single();
        if (error) throw error;
        clientId = data.id;
      }
      // Foto de referência nova (colada ou link) → vira a fonte da imagem e a imagem é refeita.
      if (clientId && (refFile || refLink.trim())) {
        let source = refLink.trim();
        if (refFile) {
          const path = `src/${clientId}-${Date.now()}.${(refFile.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "")}`;
          const up = await supabase.storage.from("client-images").upload(path, refFile, { contentType: refFile.type, upsert: true });
          if (up.error) throw up.error;
          source = path;
        }
        const { error } = await supabase.from("clients").update({ image_source: source, image_source_kind: "foto", image_origin: null }).eq("id", clientId);
        if (error) throw error;
      }
      if (clientId) pendingGen.current.add(clientId);
      // Treinamentos exigidos: tira os desmarcados e inclui os novos.
      if (clientId) {
        const before = new Set(requiredBy.get(clientId) ?? []);
        const after = new Set(reqTrainings);
        const removed = [...before].filter((t) => !after.has(t));
        const added = [...after].filter((t) => !before.has(t));
        if (removed.length) {
          const { error } = await supabase.from("client_required_trainings").delete().eq("client_id", clientId).in("training_id", removed);
          if (error) throw error;
        }
        if (added.length) {
          const { error } = await supabase.from("client_required_trainings")
            .upsert(added.map((training_id) => ({ client_id: clientId!, training_id })), { onConflict: "client_id,training_id", ignoreDuplicates: true });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Cliente atualizado" : "Cliente cadastrado");
      setRefFile(null); setRefLink("");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client-required-trainings"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-ctx"] });
      queryClient.invalidateQueries({ queryKey: ["release-by-client"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cliente excluído");
      setDeleting(null);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setReqTrainings([]);
    setAddressSource("");
    setOpen(true);
  }

  function copyAddress(clientId: string) {
    const source = clients.data?.find((c) => c.id === clientId);
    if (!source) return;
    setAddressSource(clientId);
    setForm((current) => ({
      ...current,
      address: source.address ?? "",
      number: source.number ?? "",
      neighborhood: source.neighborhood ?? "",
      city: source.city ?? "",
      state: source.state ?? "",
      zip_code: source.zip_code ?? "",
      // Mesmo endereço: mesma distância, transporte e pedágio.
      distance_km: source.distance_km != null ? String(source.distance_km) : "",
      requires_integration: source.requires_integration ?? true,
      needs_company_transport: source.needs_company_transport ?? false,
      needs_transport_voucher: source.needs_transport_voucher ?? false,
      has_toll: source.has_toll ?? false,
      toll_amount: source.toll_amount != null ? String(source.toll_amount) : "",
      trips_per_day: String(source.trips_per_day ?? 1),
    }));
  }

  function openEdit(c: Client) {
    setEditing(c);
    setReqTrainings(requiredBy.get(c.id) ?? []);
    setForm({
      name: c.name ?? "",
      address: c.address ?? "",
      number: c.number ?? "",
      neighborhood: c.neighborhood ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      zip_code: c.zip_code ?? "",
      distance_km: c.distance_km != null ? String(c.distance_km) : "",
      notes: c.notes ?? "",
      requires_integration: c.requires_integration ?? true,
      needs_company_transport: c.needs_company_transport ?? false,
      needs_transport_voucher: c.needs_transport_voucher ?? false,
      has_toll: c.has_toll ?? false,
      toll_amount: c.toll_amount != null ? String(c.toll_amount) : "",
      trips_per_day: String(c.trips_per_day ?? 1),
      cc_prefix: c.cc_prefix ?? "",
      manager_id: c.manager_id ?? NONE,
      substitute_manager_id: c.substitute_manager_id ?? NONE,
    });
    setOpen(true);
  }

  async function importClients(rows: ImportRow[]) {
    const errors: string[] = [];
    const recs: { line: number; values: Record<string, unknown> }[] = [];
    rows.forEach((r, i) => {
      const line = i + 2;
      if (!r["nome"]) {
        errors.push(`Linha ${line}: nome é obrigatório.`);
        return;
      }
      recs.push({
        line,
        values: {
          name: titleCase(r["nome"]!),
          address: titleCaseOrNull(r["endereco"] ?? ""),
          number: emptyToNull(r["numero"] ?? ""),
          neighborhood: titleCaseOrNull(r["bairro"] ?? ""),
          city: titleCaseOrNull(r["cidade"] ?? ""),
          state: emptyToNull((r["uf"] ?? "").toUpperCase()),
          zip_code: emptyToNull(r["cep"] ?? ""),
          distance_km: parseNum(r["distancia_km"] ?? ""),
          notes: emptyToNull(r["observacoes"] ?? ""),
          requires_integration: (r["exige_integracao"] ?? "").trim() === "" ? true : parseBool(r["exige_integracao"]!),
        },
      });
    });
    const result = await insertSequentially(
      recs,
      async (values) => {
        const { error } = await supabase.from("clients").insert(values as never);
        return { error };
      },
      errors,
    );
    await queryClient.invalidateQueries({ queryKey: ["clients"] });
    return result;
  }

  return (
    <div className="space-y-4">
      <CadastrosTabs active="clientes" />
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes: endereço, cidade e distância utilizada nos serviços."
        actions={
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <ImportDialog
                entity="clientes"
                description="Importe vários clientes de uma vez a partir de um arquivo .xlsx ou .csv."
                columns={IMPORT_COLUMNS}
                onImport={importClients}
              />
            )}
            {canWrite && view === "cards" && (
              <Button size="sm" variant="outline" onClick={() => void genMissing()} disabled={!!bulk} title="Gera pela IA a imagem da fachada dos clientes que ainda não têm, no mesmo estilo para todos">
                <Sparkles className={`h-4 w-4 ${bulk ? "animate-pulse" : ""}`} /> {bulk ? `Gerando ${bulk.done}/${bulk.total}…` : "Gerar imagens"}
              </Button>
            )}
            {canWrite && (
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" /> Novo cliente
              </Button>
            )}
          </div>
        }
      />

      <div className="flex items-end gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nome, cidade ou bairro"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex rounded-full border bg-muted/40 p-0.5">
          {([["cards", LayoutGrid, "Quadros"], ["list", List, "Lista"]] as const).map(([v, Icon, label]) => (
            <button key={v} type="button" onClick={() => changeView(v)} title={label} aria-label={label}
              className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors ${view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {view === "cards" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {clients.isLoading && Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-2xl bg-muted" />)}
          {!clients.isLoading && filtered.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</p>}
          {filtered.map((c, k) => {
            const img = c.image_path ? supabase.storage.from("client-images").getPublicUrl(c.image_path).data.publicUrl : null;
            const busy = genIds.has(c.id);
            return (
              <div key={c.id} className="ov-card group overflow-hidden rounded-2xl border bg-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg" style={{ animationDelay: `${Math.min(k, 12) * 40}ms` }}>
                <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                  {img ? (
                    <img src={img} alt={`Fachada ${c.name}`} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Building2 className="h-8 w-8" />
                      {canWrite && (
                        <Button size="sm" variant="outline" disabled={busy || !!bulk} onClick={() => void runGen(c.id)}>
                          <ImagePlus className="h-4 w-4" /> {busy ? "Gerando…" : "Gerar imagem"}
                        </Button>
                      )}
                    </div>
                  )}
                  {busy && img && <div className="absolute inset-0 flex items-center justify-center bg-background/60 text-xs">Gerando nova imagem…</div>}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 text-white">
                    <p className="font-display text-lg font-semibold leading-tight drop-shadow">{c.name}</p>
                  </div>
                  {c.cc_prefix && <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[10px] text-white">CC {c.cc_prefix}</span>}
                  {img && c.image_origin && <span className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[9px] text-white/85">{ORIGIN_LABEL[c.image_origin as ImageOrigin] ?? ""}</span>}
                  {canWrite && (
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {img && <Button size="icon" variant="secondary" className="h-7 w-7" disabled={busy || !!bulk} onClick={() => void runGen(c.id)} title="Gerar outra imagem"><RefreshCw className="h-3.5 w-3.5" /></Button>}
                      <Button size="icon" variant="secondary" className="h-7 w-7" onClick={() => openEdit(c)} title="Editar cliente"><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="secondary" className="h-7 w-7" onClick={() => setDeleting(c)} title="Excluir cliente"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  )}
                </div>
                <div className="space-y-2 p-3 text-sm">
                  <p className="flex gap-1.5 text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{[c.address, c.number, c.neighborhood].filter(Boolean).join(", ") || "Endereço não cadastrado"}<br />{[c.city, c.state].filter(Boolean).join("/")}{c.distance_km != null ? ` · ${c.distance_km} km` : ""}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={c.requires_integration ? "outline" : "secondary"} className="text-[10px]">{c.requires_integration ? "Exige integração" : "Não exige integração"}</Badge>
                    {c.needs_company_transport && <Badge className="text-[10px]">Transporte da empresa</Badge>}
                    {c.manager_id && <span className="ml-auto text-[11px] text-muted-foreground">Gestor: {nameById.get(c.manager_id) ?? "—"}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "list" && (
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Prefixo CC</TableHead>
              <TableHead className="hidden md:table-cell">Endereço</TableHead>
              <TableHead className="hidden lg:table-cell">Cidade</TableHead>
              <TableHead className="hidden lg:table-cell">Distância</TableHead>
              <TableHead className="hidden xl:table-cell">Gestor</TableHead>
              <TableHead>Integração</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!clients.isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="font-mono">{c.cc_prefix ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {[c.address, c.number, c.neighborhood].filter(Boolean).join(", ") || "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {[c.city, c.state].filter(Boolean).join("/") || "—"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {c.distance_km != null ? `${c.distance_km} km` : "—"}
                </TableCell>
                <TableCell className="hidden xl:table-cell">{c.manager_id ? (nameById.get(c.manager_id) ?? "—") : "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={c.requires_integration ? "outline" : "secondary"} className="text-[10px]">
                      {c.requires_integration ? "Exige integração" : "Não exige"}
                    </Badge>
                    {c.needs_company_transport && (
                      <Badge className="text-[10px]">Transporte da empresa</Badge>
                    )}
                    {false && c.needs_transport_voucher && (
                      <Badge variant="secondary" className="text-[10px]">Vale-transporte</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {canWrite && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label="Editar cliente">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canWrite && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(c)} aria-label="Excluir cliente">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Nome do cliente *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Prefixo CC (4 números)</Label>
              <Input inputMode="numeric" maxLength={4} placeholder="Ex.: 2004" value={form.cc_prefix} onChange={(e) => set("cc_prefix", e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Foto de referência da fachada ou da fábrica (opcional)</Label>
              <PastePrint file={refFile} currentUrl={editing?.image_source && !/^https?:/.test(editing.image_source) && editing.image_source_kind !== "aerea" ? supabase.storage.from("client-images").getPublicUrl(editing.image_source).data.publicUrl : null} onPaste={setRefFile} />
              <Input placeholder="ou cole o link de uma foto (https://…)" value={refLink} onChange={(e) => setRefLink(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">A imagem do quadro é feita a partir desta foto real (a IA só tira textos e anúncios). Sem foto, o sistema usa a vista aérea do satélite no endereço.</p>
            </div>
            <div className="hidden sm:block" />
            <div className="space-y-1">
              <Label>Gestor</Label>
              <Select value={form.manager_id} onValueChange={(v) => set("manager_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Substituto do gestor (opcional)</Label>
              <Select value={form.substitute_manager_id} onValueChange={(v) => set("substitute_manager_id", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nenhum</SelectItem>
                  {(people.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Valida as solicitações de compra enquanto o gestor está de férias (ou se ele não tem usuário).</p>
            </div>
            <div className="space-y-1 sm:col-span-2">
              {!editing && (
                <div className="mb-3 space-y-1">
                  <Label htmlFor="copy-client-address">Copiar endereço de outro cliente</Label>
                  <p className="text-xs text-muted-foreground">Copia também distância, integração, transporte e pedágio.</p>
                  <Select value={addressSource} onValueChange={copyAddress} disabled={!clients.data?.length}>
                    <SelectTrigger id="copy-client-address">
                      <SelectValue placeholder="Selecionar cliente cadastrado" />
                    </SelectTrigger>
                    <SelectContent>
                      {(clients.data ?? []).map((client) => (
                        <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Label>Endereço</Label>
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Número</Label>
              <Input value={form.number} onChange={(e) => set("number", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Bairro</Label>
              <Input value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Cidade</Label>
              <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>UF</Label>
              <Input maxLength={2} value={form.state} onChange={(e) => set("state", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>CEP</Label>
              <Input value={form.zip_code} onChange={(e) => set("zip_code", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Distância de ida (km)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.distance_km}
                onChange={(e) => set("distance_km", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Somente a ida; o sistema considera o dobro (ida e volta).</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="has-toll">Tem pedágio?</Label>
                <p className="text-xs text-muted-foreground">Informe o valor da ida; o sistema dobra para ida e volta.</p>
              </div>
              <Switch id="has-toll" checked={form.has_toll} onCheckedChange={(v) => set("has_toll", v)} />
            </div>
            {form.has_toll && (
              <div className="space-y-1 sm:col-span-2">
                <Label>Valor do pedágio por ida (R$)</Label>
                <Input value={form.toll_amount} onChange={(e) => set("toll_amount", e.target.value)} />
              </div>
            )}
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="requires-integration">Exige integração</Label>
                <p className="text-xs text-muted-foreground">
                  Desligue para clientes em que o colaborador pode ser escalado sem integração (ex.: Indústria).
                </p>
              </div>
              <Switch
                id="requires-integration"
                checked={form.requires_integration}
                onCheckedChange={(v) => set("requires_integration", v)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <MultiFilter
                title="Treinamentos exigidos"
                options={trainingOptions}
                values={reqTrainings}
                onChange={setReqTrainings}
                allLabel="Nenhum"
                hint="Marque os treinamentos que o cliente exige"
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Na Programação, quem está sem o treinamento ou com ele vencido não pode ser escalado neste cliente
                (salvo aceite na Conferência).
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 sm:col-span-2">
              <div>
                <Label htmlFor="needs-company-transport">Necessita de transporte da empresa?</Label>
                <p className="text-xs text-muted-foreground">
                  Gera necessidade de vagas na frota. Desligado: quem for escalado recebe VT automaticamente.
                </p>
              </div>
              <Switch
                id="needs-company-transport"
                checked={form.needs_company_transport}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, needs_company_transport: v, needs_transport_voucher: !v }))
                }
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Observações</Label>
              <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !canWrite}>
              {save.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              O cliente "{deleting?.name}" será removido permanentemente. Os serviços vinculados ficarão sem cliente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

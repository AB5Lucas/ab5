import { useEffect, useMemo, useRef, useState } from "react";
import { NOTIF_KEY } from "@/hooks/use-notifications";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchPurchaseOrderPdf, linkPurchaseOrderFile } from "@/lib/purchase-orders.functions";
import { orderFilePaths, splitOrders } from "@/lib/purchase-orders";
import { toast } from "sonner";
import { ArrowLeft, Ban, Link2, Camera, Check, Download, Eye, History, RefreshCw, Undo2, FileText, Image as ImageIcon, Paperclip, Pencil, Plus, Save, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";
import { useAccess } from "@/hooks/use-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchSelect } from "@/components/search-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRINT_REQUIRED, Pill, ScHeaderDialog, ScRemoveDialog, todayISO, useClientsList, useScRemove, useScUsers, type ScRow } from "@/components/compras/sc-shared";
import {
  SC_CATEGORIES, SC_ITEM_STATUSES, SC_NATURES, SC_PRIORITIES, SC_UNITS, itemStatusClass, STAGE_LABEL, brDate, brl, budgetMissing, deadlineControl, deliveryLabel, priorityClass, statusClass, statusDot, type ScStage,
} from "@/lib/purchase-requests";
import type { Tables } from "@/integrations/supabase/types";
import { useEditHistory } from "@/hooks/use-edit-history";
import { UndoRedoButtons } from "@/components/compras/undo-redo";
import { ScImportButtons, type ScImportItem } from "@/components/compras/sc-import-dialog";
import { PastePrint } from "@/components/compras/paste-print";
import { useActionHistory } from "@/hooks/use-action-history";
import { QuotesAttachDialog } from "@/components/compras/quotes";
import { RecommendationView } from "@/components/compras/recommendation-view";

export const Route = createFileRoute("/_authenticated/compras/solicitacoes/$id")({
  head: () => ({ meta: [{ title: "Solicitação de Compra | AB5 Hub" }, { name: "description", content: "Itens da solicitação de compra (modelo FR-CPS-SC)." }] }),
  // Aberta pelo número = só visualizar; ?edit=1 (lápis em Ações) abre já em edição.
  // ?tab=recomendacao abre direto na Recomendação de compras (comprador).
  validateSearch: (s: Record<string, unknown>): { edit?: boolean; tab?: "recomendacao" } => ({
    ...(s["edit"] === true || s["edit"] === 1 || s["edit"] === "1" || s["edit"] === "true" ? { edit: true } : {}),
    ...(s["tab"] === "recomendacao" ? { tab: "recomendacao" as const } : {}),
  }),
  component: Page,
});

type Item = Tables<"purchase_request_items">;
type Draft = { id?: string; quantity: string; unit: string; description: string; budget: string; notes: string; work_id: string; cc: string; photo_path: string | null; quote_path: string | null; link: string };
const RATEIO = "__rateio__";
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
const toDraft = (i: Item): Draft => ({
  id: i.id, quantity: String(i.quantity).replace(".", ","), unit: i.unit, description: i.description, budget: i.budget == null ? "" : String(i.budget).replace(".", ","),
  notes: i.notes ?? "", work_id: i.work_id ?? RATEIO, cc: i.cc_code ?? "", photo_path: i.photo_path, quote_path: i.quote_path, link: i.link_url ?? "",
});
const emptyDraft = (): Draft => ({ quantity: "", unit: "UN", description: "", budget: "", notes: "", work_id: RATEIO, cc: "", photo_path: null, quote_path: null, link: "" });
const isBlank = (x: Draft) => !x.id && !x.description.trim() && !x.quantity.trim() && !x.budget.trim() && !x.notes.trim() && !x.photo_path && !x.quote_path && !x.link;
/** Estado em edição na página (desfazer/refazer): linhas de itens e verba total. */
type Snap = { rows: Draft[]; total: string };
const FIELD_LABEL: Record<string, string> = {
  quantity: "Qtd", unit: "Un. medida", description: "Descrição", budget: "Verba", notes: "Observações", work_id: "Centro de custo", cc: "CC",
  photo_path: "Foto", quote_path: "Cotação", link: "Link de referência",
};

/**
 * Página da solicitação (modelo FR-CPS-SC): cabeçalho já preenchido pelo controle e a tabela de itens
 * (qtd, unidade, descrição, verba, observações, centro de custo = serviço do cliente ou rateio geral, foto).
 * O solicitante edita enquanto a SC está com ele; o comprador trata status e pedido de cada item.
 */
function Page() {
  const { id } = Route.useParams();
  const { user, role } = useCurrentUser();
  // Diretoria / administração do sistema (perfil administrador): valida, edita em validação e age como comprador.
  const isAdmin = role === "admin";
  const { canAccess } = useAccess();
  const qc = useQueryClient();
  const req = useQuery({
    queryKey: ["sc-request", id],
    queryFn: async () => (await supabase.from("purchase_requests").select("*").eq("id", id).maybeSingle()).data as ScRow | null,
    // Solicitante com a SC em validação: relê para saber se o validador abriu (bloqueia o "Puxar de volta").
    refetchInterval: (q) => ((q.state.data as ScRow | null)?.stage === "aprovacao" ? 15_000 : false),
  });
  const items = useQuery({
    queryKey: ["sc-items", id],
    queryFn: async () => ((await supabase.from("purchase_request_items").select("*").eq("request_id", id).order("item_no")).data ?? []) as Item[],
  });
  const r = req.data;
  const clients = useClientsList();
  const clientName = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const users = useScUsers();
  const userName = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.email || "—"])), [users.data]);
  const prefix = useQuery({
    queryKey: ["sc-client-prefix", r?.client_id],
    enabled: !!r?.client_id,
    queryFn: async () => (await supabase.from("clients").select("cc_prefix").eq("id", r!.client_id!).maybeSingle()).data?.cc_prefix ?? null,
  });
  // CC como na coluna CC de Serviços (prefixo do cliente + sufixo do serviço); rateio geral = prefixo + 999.
  const ccOf = (workId: string) => {
    const p = prefix.data;
    if (!p) return "—";
    if (workId === RATEIO) return `${p}999`;
    const w = (works.data ?? []).find((x) => x.id === workId);
    return w?.cc_suffix ? `${p}${w.cc_suffix}` : "—";
  };
  const works = useQuery({
    queryKey: ["sc-works", r?.client_id],
    enabled: !!r?.client_id,
    queryFn: async () => (await supabase.from("works").select("id, name, cc_suffix, active, order_number").eq("client_id", r!.client_id!).order("name")).data ?? [],
  });
  // Serviço com o nº do pedido antes ("4502503659 - Andaimes Engenharia Klaus"); vários pedidos: o primeiro e "…".
  const workLabel = (w: { name: string; order_number: string | null }) => {
    const orders = (w.order_number ?? "").split(/[\s\/;,]+/).filter(Boolean);
    return orders.length ? `${orders[0]}${orders.length > 1 ? "…" : ""} - ${w.name}` : w.name;
  };
  const workName = useMemo(() => new Map((works.data ?? []).map((w) => [w.id, workLabel(w)])), [works.data]);
  const isDraftOwner = !!r && r.requester_id === user?.id && r.stage === "rascunho";
  // Emergência: administrador envia/edita o rascunho de outro solicitante.
  const canSendDraft = !!r && r.stage === "rascunho" && (r.requester_id === user?.id || isAdmin);
  // O validador (gestor ou substituto) também pode editar a SC enquanto ela está com ele, antes de validar.
  const isValidator = !!r && !!user?.id && r.stage === "aprovacao" && (isAdmin || r.approver_id === user.id || r.substitute_id === user.id);
  const { edit: editParam, tab: tabParam } = Route.useSearch();
  const [editMode, setEditMode] = useState(!!editParam);
  const canEdit = canSendDraft || isValidator;
  const editable = canEdit && editMode;
  // Abrir a SC marca como lidas as notificações dela (RLS: só as da própria pessoa).
  useEffect(() => {
    void supabase.from("notifications").update({ read_at: new Date().toISOString() } as never).eq("entity_id", id).is("read_at", null)
      .then(() => qc.invalidateQueries({ queryKey: NOTIF_KEY }));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Validador com a SC aberta: avisa o banco a cada 30 s (vale 90 s); enquanto isso o solicitante não puxa de volta.
  useEffect(() => {
    if (!isValidator) return;
    const ping = (open: boolean) => { void supabase.rpc("purchase_request_validator_open", { _id: id, _open: open }); };
    ping(true);
    const t = setInterval(() => ping(true), 30_000);
    return () => { clearInterval(t); ping(false); };
  }, [isValidator, id]);
  const isRequesterWaiting = !!r && r.requester_id === user?.id && r.stage === "aprovacao";
  const openBy = r?.validator_open_by && r.validator_open_at && Date.now() - new Date(r.validator_open_at).getTime() < 90_000 && r.validator_open_by !== user?.id
    ? r.validator_open_by : null;
  const recall = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_recall", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("SC puxada de volta. Agora você pode editar e enviar de novo."); setEditMode(true);
      qc.invalidateQueries({ queryKey: ["sc-request", id] }); qc.invalidateQueries({ queryKey: ["sc-requests"] }); qc.invalidateQueries({ queryKey: ["menu-badges"] });
    },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ["sc-request", id] }); },
  });
  const isBuyer = !!r && r.stage === "compras" && (isAdmin || canAccess("/compras/comprador"));
  // Comprador: aba Recomendação de compras, cotações, edição do cabeçalho (com histórico) e desfazer/refazer.
  const [scTab, setScTab] = useState<"itens" | "recomendacao">(tabParam === "recomendacao" ? "recomendacao" : "itens");
  const [attachOpen, setAttachOpen] = useState(false);
  const buyerHistory = useActionHistory();
  const buyerCanEdit = isBuyer && r?.fa_state !== "em_aprovacao";
  const headerEdits = useQuery({
    queryKey: ["sc-header-edits", id],
    enabled: !!r && r.stage === "compras",
    queryFn: async () => (await supabase.from("purchase_request_edits" as never).select("*").eq("request_id", id).order("edited_at", { ascending: false })).data as unknown as
      { id: string; field: string; old_value: string | null; new_value: string | null; edited_by: string | null; edited_at: string }[] ?? [],
  });
  const rpcBuyerEdit = async (field: string, value: string | null) => {
    const { error } = await supabase.rpc("purchase_request_buyer_edit" as never, { _id: id, _field: field, _value: value ?? "" } as never);
    if (error) { toast.error(error.message); throw error; }
    await Promise.all([qc.invalidateQueries({ queryKey: ["sc-request", id] }), qc.invalidateQueries({ queryKey: ["sc-header-edits", id] }), qc.invalidateQueries({ queryKey: ["sc-rec", id] })]);
  };
  const buyerEdit = async (field: string, label: string, before: string | null, after: string | null) => {
    if ((before ?? "") === (after ?? "")) return;
    try {
      await rpcBuyerEdit(field, after);
      buyerHistory.push({ label: `${label}: ${after ?? "—"}`, undo: () => rpcBuyerEdit(field, before), redo: () => rpcBuyerEdit(field, after) });
    } catch { /* aviso já mostrado */ }
  };

  const [rows, setRows] = useState<Draft[]>([]);
  const [total, setTotal] = useState("");
  // Desfazer/refazer (Ctrl+Z / Ctrl+Y): só o rascunho em edição na tela; nada vai ao banco até Salvar itens.
  const history = useEditHistory<Snap>(500);
  const snapRef = useRef<Snap>({ rows, total });
  snapRef.current = { rows, total };
  const apply = (next: Snap, label: string, key?: string) => {
    history.push(snapRef.current, label, key);
    snapRef.current = next;
    setRows(next.rows); setTotal(next.total); setDirty(true);
  };
  const restore = (snap: Snap | null) => {
    if (!snap) return;
    snapRef.current = snap;
    setRows(snap.rows); setTotal(snap.total); setDirty(true);
  };
  const undo = (steps = 1) => restore(history.undo(snapRef.current, steps));
  const redo = (steps = 1) => restore(history.redo(snapRef.current, steps));
  const [dirty, setDirty] = useState(false);
  const [editingHeader, setEditingHeader] = useState(false);
  const [removing, setRemoving] = useState<ScRow | null>(null);
  const navigate = useNavigate();
  const router = useRouter();
  // Validador (gestor ou substituto) valida ou devolve aqui mesmo, como na aba Validação.
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const [decNotes, setDecNotes] = useState("");
  const decide = useMutation({
    mutationFn: async () => {
      if (deciding && dirty) await saveItems(); // validador editou os itens: salva antes de validar
      const { error } = await supabase.rpc("purchase_request_decide", { _id: id, _approve: !!deciding, _notes: decNotes });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(deciding ? "Validada e enviada para o Comprador" : "Devolvida ao solicitante");
      setDeciding(null); setDecNotes("");
      qc.invalidateQueries({ queryKey: ["sc-request", id] }); qc.invalidateQueries({ queryKey: ["sc-requests"] }); qc.invalidateQueries({ queryKey: ["menu-badges"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useScRemove(() => { const wasDraft = removing?.stage === "rascunho"; setRemoving(null); if (wasDraft) navigate({ to: "/compras/solicitacoes" }); });
  useEffect(() => {
    if (!items.data || !r) return;
    setRows(items.data.length ? items.data.map(toDraft) : editable ? [emptyDraft()] : []);
    setTotal(r.total_budget == null ? "" : String(r.total_budget).replace(".", ","));
    setDirty(false);
    history.clear(); // recarregou (salvou, enviou ou saiu da edição): começa um histórico novo
  }, [items.data, r?.id, r?.total_budget, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (i: number, patch: Partial<Draft>) => {
    const fields = Object.keys(patch);
    const label = `${fields.map((f) => FIELD_LABEL[f] ?? f).filter((v, k, a) => a.indexOf(v) === k).join(", ")} (item ${i + 1})`;
    const cur = snapRef.current;
    apply({ ...cur, rows: cur.rows.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, label, `row:${i}:${fields.join(",")}`);
  };
  const addRow = () => apply({ ...snapRef.current, rows: [...snapRef.current.rows, emptyDraft()] }, "Adicionar item");
  const removeRow = (i: number) => apply({ ...snapRef.current, rows: snapRef.current.rows.filter((_, j) => j !== i) }, `Tirar item ${i + 1}`);
  const setTotalField = (v: string) => apply({ ...snapRef.current, total: v }, "Verba total", "total");
  const importRows = (list: ScImportItem[]) => {
    const kept = snapRef.current.rows.filter((x) => !isBlank(x));
    apply({ ...snapRef.current, rows: [...kept, ...list.map((it) => ({ ...emptyDraft(), ...it }))] }, `Importar planilha (${list.length} itens)`);
  };
  // Atalhos na página inteira (também com o foco num campo); quadros abertos (cabeçalho, prévia, listas) ficam de fora.
  const keyRef = useRef({ undo, redo });
  keyRef.current = { undo, redo };
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const isUndo = k === "z" && !e.shiftKey;
      const isRedo = k === "y" || (k === "z" && e.shiftKey);
      if (!isUndo && !isRedo) return;
      const t = e.target as Element | null;
      if (t?.closest?.("[role=dialog], [role=alertdialog], [data-radix-popper-content-wrapper]")) return;
      e.preventDefault();
      if (isUndo) keyRef.current.undo(); else keyRef.current.redo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editable]);
  const itemsTotal = rows.reduce((s, x) => s + (num(x.budget) ?? 0), 0);

  const saveItems = async () => {
    const filled = rows.filter((x) => x.description.trim() || x.quantity.trim());
    for (const [i, x] of filled.entries()) {
      if (!x.description.trim()) throw new Error(`Item ${i + 1}: escreva a descrição.`);
      if (!(num(x.quantity)! > 0)) throw new Error(`Item ${i + 1}: informe a quantidade.`);
    }
    const keep = new Set(filled.filter((x) => x.id).map((x) => x.id!));
    const remove = (items.data ?? []).filter((i) => !keep.has(i.id)).map((i) => i.id);
    if (remove.length) { const { error } = await supabase.from("purchase_request_items").delete().in("id", remove); if (error) throw error; }
    for (const [i, x] of filled.entries()) {
      const payload = {
        request_id: id, item_no: i + 1, quantity: num(x.quantity)!, unit: x.unit.trim() || "UN", description: x.description.trim(),
        budget: num(x.budget), notes: x.notes.trim() || null, work_id: x.work_id === RATEIO ? null : x.work_id, cc_code: x.cc.trim() || null, photo_path: x.photo_path, quote_path: x.quote_path, link_url: x.link.trim() || null,
      };
      const { error } = x.id ? await supabase.from("purchase_request_items").update(payload).eq("id", x.id) : await supabase.from("purchase_request_items").insert(payload);
      if (error) throw error;
    }
    const { error } = await supabase.from("purchase_requests").update({ total_budget: num(total) }).eq("id", id);
    if (error) throw error;
  };
  const refresh = () => { qc.invalidateQueries({ queryKey: ["sc-items", id] }); qc.invalidateQueries({ queryKey: ["sc-request", id] }); qc.invalidateQueries({ queryKey: ["sc-requests"] }); };
  const save = useMutation({ mutationFn: saveItems, onSuccess: () => { toast.success("Itens salvos"); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const send = useMutation({
    mutationFn: async () => {
      if (r!.system === "TOTVS" && !r!.photo_path) throw new Error(PRINT_REQUIRED);
      const filled = rows.filter((x) => x.description.trim() || x.quantity.trim());
      if (r!.system !== "TOTVS" && budgetMissing(r!.nature, num(total), filled.map((x) => num(x.budget)))) throw new Error("Informe a verba de cada item ou a verba total (só a natureza PROGRAMADA dispensa).");
      await saveItems();
      const { data, error } = await supabase.rpc("purchase_request_send", { _id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: (to) => { toast.success(to === "compras" ? "Enviada direto para o Comprador" : "Enviada para o validador"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const setItem = useMutation({
    mutationFn: async ({ item, status, order, date }: { item: string; status: string; order: string; date?: string }) => {
      const { error } = await supabase.rpc("purchase_item_set", { _item: item, _status: status, _order: order, ...(date ? { _date: date } : {}) });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success("Item atualizado");
      qc.invalidateQueries({ queryKey: ["sc-items", id] });
      // Procura o arquivo quando o nº muda ou ainda não há arquivo ligado.
      const prev = (items.data ?? []).find((it) => it.id === v.item);
      if (!v.date && v.order.trim() && (prev?.order_number !== v.order.trim() || !prev?.order_file_path)) findOrder.mutate({ item: v.item, order: v.order.trim() });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  // Pedido de compras: ao digitar o nº, o sistema procura o PDF na pasta 04 COMPRAS/02 PEDIDOS DE COMPRAS/<ano> do SharePoint.
  const linkOrder = useServerFn(linkPurchaseOrderFile);
  const findOrder = useMutation({
    mutationFn: (v: { item: string; order: string }) => linkOrder({ data: v }),
    onSuccess: (file) => {
      qc.invalidateQueries({ queryKey: ["sc-items", id] });
      if (file.missing.length) toast.warning(`Pedido não encontrado na pasta de pedidos de compras: ${file.missing.join(", ")}`);
      if (file.found.length) toast.success(`Pedido encontrado: ${file.found.join(", ")}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [orders, setOrders] = useState<Record<string, string>>({});
  // PDF do pedido: o app busca no SharePoint e mostra aqui (quem não tem acesso à pasta também vê); nada fica gravado.
  const getOrderPdf = useServerFn(fetchPurchaseOrderPdf);
  const [orderPdf, setOrderPdf] = useState<{ loading: boolean; name?: string; url?: string }>({ loading: false });
  const openOrder = async (item: string, index: number) => {
    setOrderPdf({ loading: true });
    const t = toast.loading("Buscando o pedido…");
    try {
      const f = await getOrderPdf({ data: { item, index } });
      const bin = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bin], { type: "application/pdf" }));
      setOrderPdf({ loading: false, name: f.name, url });
      toast.dismiss(t);
    } catch (e) {
      setOrderPdf({ loading: false });
      toast.error((e as Error).message, { id: t });
    }
  };
  const closeOrderPdf = () => setOrderPdf((o) => { if (o.url) URL.revokeObjectURL(o.url); return { loading: false }; });

  const putFile = async (file: File) => {
    const path = `${id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("purchase-photos").upload(path, file);
    if (error) { toast.error(error.message); return null; }
    return path;
  };
  const upload = async (i: number, file: File) => {
    const path = await putFile(file);
    if (!path) return;
    change(i, { photo_path: path });
    toast.success("Foto anexada (salve os itens)");
  };

  // Cotação ou orçamento (foto ou PDF) da verba do item, ou da verba total (i = -1).
  const uploadQuote = async (i: number, file: File) => {
    const path = await putFile(file);
    if (!path) return;
    if (i < 0) {
      const { error } = await supabase.from("purchase_requests").update({ quote_path: path }).eq("id", id);
      if (error) { toast.error(error.message); return; }
      refresh();
      toast.success("Cotação anexada");
      return;
    }
    change(i, { quote_path: path });
    toast.success("Cotação anexada (salve os itens)");
  };
  // Print da SC do TOTVS: prévia (link assinado) e troca colando outro (grava no mesmo bucket/coluna).
  const printUrl = useQuery({
    queryKey: ["sc-print-url", r?.photo_path],
    enabled: !!r?.photo_path && !/^https?:\/\//.test(r?.photo_path ?? ""),
    staleTime: 5 * 60_000,
    queryFn: async () => (await supabase.storage.from("purchase-photos").createSignedUrl(r!.photo_path!, 600)).data?.signedUrl ?? null,
  });
  const savePrint = useMutation({
    mutationFn: async (file: File) => {
      const path = `totvs/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const up = await supabase.storage.from("purchase-photos").upload(path, file);
      if (up.error) throw up.error;
      const { error } = await supabase.from("purchase_requests").update({ photo_path: path }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Print da solicitação trocado"); qc.invalidateQueries({ queryKey: ["sc-request", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const openPhoto = async (path: string) => {
    if (/^https?:\/\//.test(path)) { window.open(path, "_blank", "noopener"); return; } // arquivo do SharePoint
    const { data, error } = await supabase.storage.from("purchase-photos").createSignedUrl(path, 600);
    if (error || !data) { toast.error(error?.message ?? "Foto indisponível"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  if (req.isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!r) return <p className="text-sm text-muted-foreground">Solicitação não encontrada ou sem acesso.</p>;
  const dl = deadlineControl(r, todayISO());
  const cName = r.client_id ? clientName.get(r.client_id) ?? "—" : "—";
  // Cabeçalho em colunas, como o modelo FR-CPS-SC: quem/quando · o quê · para onde/quando entregar · andamento.
  const created = new Date(r.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const headCols: [string, React.ReactNode][][] = [
    [["Data da SC", brDate(r.request_date)], ["Horário", created], ["Requisitante", r.requester_name]],
    [
      ["Categoria", buyerCanEdit ? <InlineSelect key="c" value={r.category} options={SC_CATEGORIES} onChange={(v) => void buyerEdit("category", "Categoria", r.category, v)} /> : r.category ?? "—"],
      ["Natureza da compra", buyerCanEdit ? <InlineSelect key="n" value={r.nature} options={SC_NATURES} onChange={(v) => void buyerEdit("nature", "Natureza", r.nature, v)} /> : r.nature ?? "—"],
      ["Prioridade", buyerCanEdit
        ? <InlineSelect key="p" value={r.priority} options={SC_PRIORITIES.map((p) => p.value)} render={(v) => <Pill className={priorityClass(v)}>{v}</Pill>} onChange={(v) => void buyerEdit("priority", "Prioridade", r.priority, v)} />
        : r.priority ? <Pill key="p" className={priorityClass(r.priority)}>{r.priority}</Pill> : "—"],
    ],
    [["Cliente", cName], ["Prazo de entrega", buyerCanEdit
      ? <Input key={`d-${r.due_date}`} type="date" className="h-7 w-40 text-xs" defaultValue={r.due_date ?? ""} onBlur={(e) => void buyerEdit("due_date", "Prazo de entrega", r.due_date, e.target.value || null)} />
      : brDate(r.due_date)], ["Local de entrega", deliveryLabel(r, cName)]],
    [
      ["Envio", r.sent_at ? new Date(r.sent_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "não enviado"],
      ["Controle de prazo", <Pill key="d" className={dl.cls}>{dl.label}</Pill>],
      ["Etapa / status", <span key="s" className="space-x-1">{STAGE_LABEL[r.stage as ScStage]} <Pill className={statusClass(r.status)}>{r.status}</Pill> <span className="text-xs text-muted-foreground">{brDate(r.status_at)}</span></span>],
    ],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Volta para a tela de onde veio (Solicitações, Validação ou Comprador); aberta direto, vai para Solicitações. */}
        <Button variant="ghost" size="sm" onClick={() => (router.history.canGoBack() ? router.history.back() : navigate({ to: "/compras/solicitacoes" }))}>
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <span className={`inline-block h-3 w-3 rounded-full ${statusDot(r.status)}`} title={r.status} aria-label={`Status: ${r.status}`} />
        <h1 className="font-display text-xl font-semibold uppercase tracking-wide">{r.number}</h1>
        <div className="ml-auto flex gap-2">
          {isBuyer && <UndoRedoButtons undoLabels={buyerHistory.undoLabels} redoLabels={buyerHistory.redoLabels} onUndo={(n) => void buyerHistory.undo(n)} onRedo={(n) => void buyerHistory.redo(n)} />}
          {buyerCanEdit && <Button variant="outline" size="sm" onClick={() => setAttachOpen(true)}><Paperclip className="h-4 w-4" /> Cotações</Button>}
          {canEdit && !editMode && <Button variant="outline" size="sm" onClick={() => setEditMode(true)}><Pencil className="h-4 w-4" /> Editar</Button>}
          {editable && <UndoRedoButtons undoLabels={history.undoLabels} redoLabels={history.redoLabels} onUndo={undo} onRedo={redo} />}
          {editable && <Button variant="outline" size="sm" onClick={() => setEditingHeader(true)}><Pencil className="h-4 w-4" /> Editar cabeçalho</Button>}
          {editable && <Button variant="outline" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}><Save className="h-4 w-4" /> Salvar itens</Button>}
          {canSendDraft && <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()}><Send className="h-4 w-4" /> Enviar</Button>}
          {isDraftOwner && <Button variant="ghost" size="sm" onClick={() => setRemoving(r)}><Trash2 className="h-4 w-4 text-destructive" /> Apagar</Button>}
          {isValidator && (
            <>
              <Button size="sm" onClick={() => setDeciding(true)}><Check className="h-4 w-4" /> Validar</Button>
              <Button variant="outline" size="sm" onClick={() => setDeciding(false)}><Undo2 className="h-4 w-4" /> Devolver</Button>
            </>
          )}
          {isRequesterWaiting && (
            <Button variant="outline" size="sm" disabled={!!openBy || recall.isPending} onClick={() => recall.mutate()}
              title={openBy ? "Bloqueada: aberta para o validador" : "Volta para você editar; depois envie de novo"}>
              <Undo2 className="h-4 w-4" /> Puxar de volta
            </Button>
          )}
          {r.requester_id === user?.id && (r.stage === "aprovacao" || r.stage === "compras") && <Button variant="outline" size="sm" onClick={() => setRemoving(r)}><Ban className="h-4 w-4" /> Cancelar SC</Button>}
        </div>
      </div>

      {isRequesterWaiting && openBy && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <b>Solicitação bloqueada</b>: está aberta para o Validador <b>{userName.get(openBy) ?? "—"}</b>. Você poderá puxar de volta quando ele fechar.
        </div>
      )}

      <div className="panel p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-border pb-2">
          <span className="text-sm font-semibold">Ab5 Indústria e Comércio LTDA</span>
          <span className="flex items-center gap-2">
            <span className="font-display text-sm uppercase tracking-wide">Solicitação de compras</span>
            {r.stage === "compras" && <EditHistory edits={headerEdits.data ?? []} userName={userName} />}
          </span>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border">
          {headCols.map((col, i) => (
            <dl key={i} className="space-y-2 lg:pl-4 lg:first:pl-0">
              {col.map(([k, v]) => <div key={k}><dt className="text-[11px] uppercase text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
            </dl>
          ))}
        </div>
        {r.system === "TOTVS" && (
          <p className="mt-3 rounded-md bg-muted p-2 text-xs">
            <b>Centro de custo:</b> {r.work_id ? workName.get(r.work_id) ?? "—" : "Rateio geral do cliente"} · <b>CC:</b> <span className="font-mono">{r.cc_code || ccOf(r.work_id ?? RATEIO)}</span>
          </p>
        )}
        {r.justification && <p className="mt-3 rounded-md bg-muted p-2 text-xs"><b>Justificativa:</b> {r.justification}</p>}
        {r.notes && <p className="mt-3 rounded-md bg-muted p-2 text-xs"><b>Observações:</b> {r.notes}</p>}
        {r.return_notes && (r.stage === "rascunho" || (r.stage === "aprovacao" && r.return_notes.startsWith("Comprador (ao validador)"))) && <p className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive"><b>Devolvida</b> · {r.return_notes}</p>}
        {r.approver_notes && r.stage !== "rascunho" && <p className="mt-2 rounded-md bg-muted p-2 text-xs"><b>Validador:</b> {r.approver_notes}</p>}
        {r.system === "TOTVS" && canSendDraft && editMode ? (
          // Rascunho do TOTVS (ex.: devolvido): o print só se troca colando; obrigatório para enviar.
          <div className="mt-3 max-w-xl space-y-1">
            <Label className="block">Print da solicitação <span className="text-destructive">*</span></Label>
            <PastePrint file={null} currentUrl={printUrl.data ?? null} disabled={savePrint.isPending} onPaste={(f) => savePrint.mutate(f)} />
          </div>
        ) : r.photo_path && <Button variant="outline" size="sm" className="mt-2" onClick={() => openPhoto(r.photo_path!)}><ImageIcon className="h-4 w-4" /> Print da SC do TOTVS</Button>}
        <p className="mt-2 text-xs text-muted-foreground"><b>Observadores:</b> {(r.observer_ids ?? []).map((u) => userName.get(u) ?? "…").join(", ") || "—"}</p>
        {r.buyer_notes && <p className="mt-2 rounded-md bg-muted p-2 text-xs"><b>Comprador:</b> {r.buyer_notes}</p>}
      </div>

      {isBuyer && (
        <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-sm text-muted-foreground" role="tablist">
          {([["itens", "Solicitação"], ["recomendacao", "Recomendação de compras"]] as const).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={scTab === v} onClick={() => setScTab(v)}
              className={`rounded-md px-3 py-1 transition-colors ${scTab === v ? "bg-background font-medium text-foreground shadow-sm" : "hover:text-foreground"}`}>{l}</button>
          ))}
        </div>
      )}
      {isBuyer && scTab === "recomendacao" ? (
        <RecommendationView requestId={id} mode="comprador" embedded history={buyerHistory} />
      ) : (
      <>
      <div className="panel overflow-x-auto">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Item</TableHead>
              <TableHead className="w-20">Qtd</TableHead>
              <TableHead className="min-w-24">Un. medida</TableHead>
              <TableHead className="min-w-72">Descrição</TableHead>
              <TableHead className="min-w-36">Verba (R$)</TableHead>
              <TableHead className="min-w-40">Observações</TableHead>
              <TableHead className="min-w-48">Centro de custo</TableHead>
              <TableHead className="w-28">CC</TableHead>
              <TableHead className="w-16">Foto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="min-w-32">Pedido de compras AB5</TableHead>
              {editable && <TableHead className="w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!rows.length && <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground">Nenhum item.</TableCell></TableRow>}
            {rows.map((x, i) => {
              const saved = x.id ? (items.data ?? []).find((it) => it.id === x.id) : undefined;
              return (
                <TableRow key={x.id ?? `new-${i}`}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{editable ? <Input className="h-8 min-w-14 text-sm" inputMode="decimal" value={x.quantity} onChange={(e) => change(i, { quantity: e.target.value })} /> : x.quantity}</TableCell>
                  <TableCell>
                    {editable ? (
                      <>
                        <Input className="h-8 min-w-20 text-sm" list="sc-units" value={x.unit} onChange={(e) => change(i, { unit: e.target.value.toUpperCase() })} />
                        <datalist id="sc-units">{SC_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
                      </>
                    ) : x.unit}
                  </TableCell>
                  <TableCell className="align-top">{editable
                    // A descrição quebra em várias linhas e a caixa cresce com o texto.
                    ? <Textarea rows={1} className="min-h-8 resize-none py-1.5 text-sm [field-sizing:content]" value={x.description} onChange={(e) => change(i, { description: e.target.value })} />
                    : <span className="whitespace-pre-wrap break-words">{x.description}</span>}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {editable ? <Input className="h-8 min-w-24 text-sm" inputMode="decimal" placeholder="0,00" value={x.budget} onChange={(e) => change(i, { budget: e.target.value })} /> : <span className="whitespace-nowrap">{brl(num(x.budget))}</span>}
                      {x.quote_path && !editable && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Ver cotação/orçamento" onClick={() => openPhoto(x.quote_path!)}><FileText className="h-4 w-4 text-primary" /></Button>}
                      {editable && (
                        <AttachMenu path={x.quote_path} accept="image/*,application/pdf" icon={Paperclip} what="cotação ou orçamento (foto ou PDF)"
                          onView={() => openPhoto(x.quote_path!)} onPick={(f) => void uploadQuote(i, f)} onRemove={() => change(i, { quote_path: null })} />
                      )}
                      <ItemLink value={x.link} editable={editable} onChange={(v) => change(i, { link: v })} />
                    </div>
                  </TableCell>
                  <TableCell className="align-top">{editable
                    ? <Textarea rows={1} className="min-h-8 resize-none py-1.5 text-sm [field-sizing:content]" value={x.notes} onChange={(e) => change(i, { notes: e.target.value })} />
                    : <span className="whitespace-pre-wrap break-words">{x.notes || "—"}</span>}</TableCell>
                  <TableCell>
                    {editable ? (
                      <SearchSelect className="h-8" value={x.work_id} onChange={(v) => change(i, { work_id: v, cc: "" })} searchPlaceholder="Digite o pedido, serviço ou CC"
                        options={[{ value: RATEIO, label: "Rateio geral do cliente" },
                          ...(works.data ?? []).filter((w) => w.active || w.id === x.work_id).map((w) => ({ value: w.id, label: workLabel(w), hint: [w.order_number, ccOf(w.id)].filter((v) => v && v !== "—").join(" ") }))]} />
                    ) : x.work_id === RATEIO ? "Rateio geral" : workName.get(x.work_id) ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono">
                    {editable ? (
                      <Input className="h-8 w-28 font-mono" value={x.cc} placeholder={ccOf(x.work_id)} title="CC automático; digite para trocar"
                        onChange={(e) => change(i, { cc: e.target.value.replace(/[^\w]/g, "") })} />
                    ) : x.cc || ccOf(x.work_id)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {x.photo_path && !editable && <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver foto" onClick={() => openPhoto(x.photo_path!)}><ImageIcon className="h-4 w-4" /></Button>}
                      {editable && (
                        <AttachMenu path={x.photo_path} accept="image/*" icon={Camera} what="foto"
                          onView={() => openPhoto(x.photo_path!)} onPick={(f) => void upload(i, f)} onRemove={() => change(i, { photo_path: null })} />
                      )}
                      {!x.photo_path && !editable && <span className="text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {isBuyer && saved ? (
                      <div className="space-y-1">
                        <Select value={saved.status} onValueChange={(v) => setItem.mutate({ item: saved.id, status: v, order: orders[saved.id] ?? saved.order_number ?? "" })}>
                          <SelectTrigger className={`h-8 w-44 ${itemStatusClass(saved.status)}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{SC_ITEM_STATUSES.map((s) => <SelectItem key={s} value={s}><Pill className={itemStatusClass(s)}>{s}</Pill></SelectItem>)}</SelectContent>
                        </Select>
                        {/* Data real do status (pode ter acontecido em outro dia). */}
                        <Input type="date" className="h-7 w-44 text-xs" aria-label="Data do status" title="Data real do status"
                          value={saved.status_at ?? ""}
                          onChange={(e) => e.target.value && setItem.mutate({ item: saved.id, status: saved.status, order: orders[saved.id] ?? saved.order_number ?? "", date: e.target.value })} />
                      </div>
                    ) : (
                      <span className="whitespace-nowrap">
                        {saved?.status || r.stage !== "rascunho"
                          ? <Pill className={itemStatusClass(saved?.status ?? "SOLICITAÇÃO ENVIADA")}>{saved?.status ?? "SOLICITAÇÃO ENVIADA"}</Pill>
                          : "—"}
                        {saved?.status_at && <span className="block text-[11px] text-muted-foreground">{brDate(saved.status_at)}</span>}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isBuyer && saved ? (
                      <Input className="h-8" value={orders[saved.id] ?? saved.order_number ?? ""} onChange={(e) => setOrders((o) => ({ ...o, [saved.id]: e.target.value }))}
                        onBlur={() => { const v = orders[saved.id]; if (v !== undefined && v !== (saved.order_number ?? "")) setItem.mutate({ item: saved.id, status: saved.status, order: v }); }} />
                    ) : saved?.order_number ?? "—"}
                    {saved && (saved.order_file_path || (isBuyer && saved.order_number)) && (
                      <div className="mt-1 flex items-center gap-1">
                        {(() => {
                          const files = orderFilePaths(saved.order_file_path);
                          const many = splitOrders(saved.order_number).length > 1 || files.length > 1;
                          return files.map((url, k) => url && (
                            <Button key={k} variant="ghost" size="sm" className="h-7 px-2" title={`Abrir o pedido de compras ${splitOrders(saved.order_number)[k] ?? ""}`} disabled={orderPdf.loading} onClick={() => void openOrder(saved.id, k)}>
                              <FileText className="h-4 w-4 text-primary" /> {many ? `Pedido ${k + 1}` : "Pedido"}
                            </Button>
                          ));
                        })()}
                        {isBuyer && saved.order_number && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={findOrder.isPending} title="Procurar de novo na pasta de pedidos de compras"
                            onClick={() => findOrder.mutate({ item: saved.id, order: saved.order_number! })}>
                            <RefreshCw className={`h-3.5 w-3.5 ${findOrder.isPending ? "animate-spin" : ""}`} /> {saved.order_file_path ? "" : "Procurar"}
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Tirar item" onClick={() => removeRow(i)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right">Verba dos itens</TableCell>
              <TableCell className="tabular-nums">{brl(itemsTotal)}</TableCell>
              <TableCell colSpan={editable ? 7 : 6} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {editable && <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4" /> Adicionar item</Button>}
        {editable && (
          <ScImportButtons works={(works.data ?? []).filter((w) => w.active)} workLabel={(wid) => workName.get(wid) ?? "—"} onImport={importRows} />
        )}
        <div className="space-y-1">
          <Label htmlFor="sc-total" className="text-xs">Verba (R$) total</Label>
          {editable
            ? <Input id="sc-total" className="w-44" inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotalField(e.target.value)} />
            : <p className="text-sm font-medium">{brl(r.total_budget)}</p>}
        </div>
        <div className="flex items-center gap-1">
          {r.quote_path && <Button variant="outline" size="sm" onClick={() => openPhoto(r.quote_path!)}><FileText className="h-4 w-4" /> Cotação/Orçamento</Button>}
          {editable && (
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-accent" title="Foto ou PDF">
              <Paperclip className="h-4 w-4" /> {r.quote_path ? "Trocar Cotação/Orçamento" : "Cotação/Orçamento"}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadQuote(-1, f); e.target.value = ""; }} />
            </label>
          )}
        </div>
        {editable && (
          <p className="text-xs text-muted-foreground">
            {(r.nature ?? "").toUpperCase() === "PROGRAMADA" ? "Natureza PROGRAMADA: a verba não é obrigatória." : "Obrigatório: a verba de cada item ou a verba total."}
          </p>
        )}
      </div>

      </>
      )}
      {attachOpen && <QuotesAttachDialog row={r} onClose={() => setAttachOpen(false)} onDone={() => { setScTab("recomendacao"); void qc.invalidateQueries({ queryKey: ["sc-rec", id] }); }} />}

      <Dialog open={deciding !== null} onOpenChange={(o) => { if (!o) { setDeciding(null); setDecNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding ? "Validar solicitação" : "Devolver ao solicitante"}</DialogTitle>
            <DialogDescription>{r.number}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="dec-notes">{deciding ? "Observação (opcional)" : "Motivo da devolução"}</Label>
            <Textarea id="dec-notes" rows={3} value={decNotes} onChange={(e) => setDecNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancelar</Button>
            <Button disabled={decide.isPending || (!deciding && !decNotes.trim())} onClick={() => decide.mutate()}>{deciding ? "Validar" : "Devolver"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ScHeaderDialog open={editingHeader} onOpenChange={setEditingHeader} editing={r} />
      <ScRemoveDialog row={removing} onClose={() => setRemoving(null)} pending={remove.isPending} onConfirm={(x) => remove.mutate(x)} />
      <Dialog open={!!orderPdf.url} onOpenChange={(o) => !o && closeOrderPdf()}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col">
          <DialogHeader><DialogTitle className="truncate pr-8">{orderPdf.name ?? "Pedido de compras"}</DialogTitle></DialogHeader>
          {orderPdf.url && <iframe title="Pedido de compras" src={orderPdf.url} className="min-h-0 w-full flex-1 rounded border" />}
          <div className="flex justify-end gap-2">
            {orderPdf.url && <Button asChild variant="outline"><a href={orderPdf.url} download={orderPdf.name ?? "pedido.pdf"}><Download className="h-4 w-4" /> Baixar</a></Button>}
            <Button onClick={closeOrderPdf}>Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Link de referência do produto (ex.: anúncio): ícone ao lado do clipe; editando abre um campo, senão abre o link. */
/** Clipe/câmera do item: sem arquivo abre a escolha; com arquivo abre um quadro com Visualizar, Trocar e Remover (como no Excel). */
function AttachMenu({ path, accept, icon: Icon, what, onView, onPick, onRemove }: {
  path: string | null; accept: string; icon: typeof Paperclip; what: string;
  onView: () => void; onPick: (f: File) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = () => { setOpen(false); input.current?.click(); };
  const file = <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />;
  if (!path) {
    return (
      <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-accent" title={`Anexar ${what}`} onClick={pick}>
        <Icon className="h-4 w-4 text-muted-foreground" />{file}
      </button>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-accent" title={`${what[0]!.toUpperCase()}${what.slice(1)} anexada`}>
          <Icon className="h-4 w-4 text-primary" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="start">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setOpen(false); onView(); }}><Eye className="h-4 w-4" /> Visualizar</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={pick}><RefreshCw className="h-4 w-4" /> Trocar</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start text-destructive" onClick={() => { setOpen(false); onRemove(); }}><Trash2 className="h-4 w-4" /> Remover</Button>
      </PopoverContent>
      {file}
    </Popover>
  );
}

function ItemLink({ value, editable, onChange }: { value: string; editable: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const href = /^https?:\/\//i.test(value) ? value : value ? `https://${value}` : "";
  if (!editable) {
    return value ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-accent" title={`Abrir link de referência: ${value}`}>
        <Link2 className="h-4 w-4 text-primary" />
      </a>
    ) : null;
  }
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(value); }}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-accent" title={value ? `Link de referência: ${value}` : "Incluir link de referência do produto"}>
          <Link2 className={`h-4 w-4 ${value ? "text-primary" : "text-muted-foreground"}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" align="start">
        <Label htmlFor="item-link">Link de referência do produto</Label>
        <Input id="item-link" autoFocus placeholder="https://…" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onChange(draft.trim()); setOpen(false); } }} />
        <div className="flex justify-between gap-2">
          {value ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Abrir</a> : <span />}
          <div className="flex gap-2">
            {value && <Button size="sm" variant="ghost" onClick={() => { onChange(""); setOpen(false); }}>Remover</Button>}
            <Button size="sm" onClick={() => { onChange(draft.trim()); setOpen(false); }}>OK</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Campo do cabeçalho que o comprador edita na hora (grava pela função com histórico). */
function InlineSelect({ value, options, onChange, render }: { value: string | null; options: readonly string[]; onChange: (v: string) => void; render?: (v: string) => React.ReactNode }) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => { if (v !== value) onChange(v); }}>
      <SelectTrigger className="h-7 w-full max-w-60 text-xs"><SelectValue placeholder="—">{value ? (render ? render(value) : value) : "—"}</SelectValue></SelectTrigger>
      <SelectContent className="max-h-72">{options.map((o) => <SelectItem key={o} value={o}>{render ? render(o) : o}</SelectItem>)}</SelectContent>
    </Select>
  );
}

const EDIT_FIELD: Record<string, string> = { category: "Categoria", nature: "Natureza da compra", priority: "Prioridade", due_date: "Prazo de entrega" };
/** Reloginho do cabeçalho: histórico das edições feitas pelo comprador. */
function EditHistory({ edits, userName }: { edits: { id: string; field: string; old_value: string | null; new_value: string | null; edited_by: string | null; edited_at: string }[]; userName: Map<string, string> }) {
  const fmt = (f: string, v: string | null) => (v == null ? "—" : f === "due_date" ? brDate(v) : v);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="relative inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted" title="Histórico de edições do cabeçalho" aria-label="Histórico de edições">
          <History className="h-4 w-4 text-muted-foreground" />
          {edits.length > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[9px] leading-tight text-primary-foreground">{edits.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">Histórico de edições</div>
        <div className="max-h-80 overflow-y-auto p-2 text-xs">
          {!edits.length && <p className="p-2 text-muted-foreground">Nenhuma edição no cabeçalho.</p>}
          {edits.map((e) => (
            <div key={e.id} className="border-b border-border/60 px-1 py-1.5 last:border-0">
              <div className="flex justify-between gap-2 text-muted-foreground">
                <span>{new Date(e.edited_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="truncate">{userName.get(e.edited_by ?? "") ?? "—"}</span>
              </div>
              <div><b>{EDIT_FIELD[e.field] ?? e.field}:</b> <span className="line-through opacity-60">{fmt(e.field, e.old_value)}</span> → <span className="font-medium">{fmt(e.field, e.new_value)}</span></div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

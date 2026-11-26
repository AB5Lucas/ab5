import { useMemo, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GripVertical, Lock, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useScUsers } from "@/components/compras/sc-shared";
import { useFaPerms } from "@/components/compras/recommendation-view";
import { cn } from "@/lib/utils";

/** Blocos das alçadas de compra (purchase_alcadas.alcada). */
export const ALCADAS = [
  { key: "comprador", title: "Comprador", desc: "Quem tem acesso à tela de Comprador." },
  { key: "exec_industria", title: "Alçada de Aprovação Executiva Indústria", desc: "Pode aprovar todas as compras, independentemente de cliente, obra, valor, orçamento ou classificação. Dá ciência das compras aprovadas pelos outros níveis (SCs da Indústria)." },
  { key: "exec_servicos", title: "Alçada de Aprovação Executiva Serviços Externos", desc: "Pode aprovar todas as compras, independentemente de cliente, obra, valor, orçamento ou classificação. Dá ciência das compras aprovadas pelos outros níveis (SCs de Serviços)." },
  { key: "operacional", title: "Operacional", desc: "Aprova compras dentro da verba aprovada e compras programadas, previstas no planejamento. Depois, a recomendação aparece para o nível Executivo dar ciência." },
  { key: "compartilhada", title: "Compartilhada (Aprovação dupla: Operacional + Gestor da obra)", desc: "Prazo de até 2 dias: aprova compras acima da verba, não programadas ou que afetem o orçamento da obra. A aprovação dupla é obrigatória (uma só não libera o envio ao Comprador). Depois, o nível Executivo dá ciência." },
] as const;
type AlcadaKey = (typeof ALCADAS)[number]["key"];

type Drag = { uid: string; from: AlcadaKey | null };
const MIME = "application/x-alcada";

/**
 * Aba Alçadas do Aprovador: pessoas à esquerda e os blocos das alçadas à direita; arrastar o nome para um bloco
 * inclui a pessoa nele (de um bloco para outro, move). Só a Diretoria (admin) e a Vitória alteram.
 */
export function AlcadasPanel() {
  const qc = useQueryClient();
  const perms = useFaPerms();
  const editor = !!perms.data?.editor;
  const users = useScUsers();
  const rows = useQuery({
    queryKey: ["purchase-alcadas"],
    queryFn: async () => ((await supabase.from("purchase_alcadas" as never).select("user_id, alcada")).data ?? []) as unknown as { user_id: string; alcada: AlcadaKey }[],
  });
  const [q, setQ] = useState("");
  const [over, setOver] = useState<AlcadaKey | null>(null);
  const active = useMemo(() => (users.data ?? []).filter((u) => u.active && u.full_name), [users.data]);
  const name = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.email || "—"])), [users.data]);
  const byBlock = useMemo(() => {
    const m = new Map<AlcadaKey, string[]>(ALCADAS.map((a) => [a.key, []]));
    for (const r of rows.data ?? []) m.get(r.alcada)?.push(r.user_id);
    for (const [, v] of m) v.sort((a, b) => (name.get(a) ?? "").localeCompare(name.get(b) ?? "", "pt-BR"));
    return m;
  }, [rows.data, name]);
  const blocksOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows.data ?? []) m.set(r.user_id, (m.get(r.user_id) ?? 0) + 1);
    return m;
  }, [rows.data]);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const people = active.filter((u) => !q.trim() || norm(u.full_name ?? "").includes(norm(q.trim())));

  const set = useMutation({
    mutationFn: async (v: { uid: string; alcada: AlcadaKey; on: boolean }) => {
      const { error } = await supabase.rpc("purchase_alcada_set" as never, { _user: v.uid, _alcada: v.alcada, _on: v.on } as never);
      if (error) throw error;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["purchase-alcadas"] }); void qc.invalidateQueries({ queryKey: ["fa-perms"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const drop = async (to: AlcadaKey, e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    if (!editor) return;
    let d: Drag;
    try { d = JSON.parse(e.dataTransfer.getData(MIME)) as Drag; } catch { return; }
    if (d.from === to) return;
    if ((byBlock.get(to) ?? []).includes(d.uid)) { if (d.from) set.mutate({ uid: d.uid, alcada: d.from, on: false }); return; }
    await set.mutateAsync({ uid: d.uid, alcada: to, on: true }).catch(() => undefined);
    if (d.from) set.mutate({ uid: d.uid, alcada: d.from, on: false });
  };
  const dragStart = (d: Drag) => (e: DragEvent) => { e.dataTransfer.setData(MIME, JSON.stringify(d)); e.dataTransfer.effectAllowed = d.from ? "move" : "copy"; };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {editor ? "Arraste o nome da lista para um bloco (ou de um bloco para outro). A pessoa pode estar em mais de um bloco." : <><Lock className="h-3.5 w-3.5" /> Só a Diretoria e a Vitória alteram as alçadas.</>}
      </p>
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="panel flex max-h-[70vh] flex-col p-3">
          <div className="mb-2 text-sm font-medium">Pessoas ({active.length})</div>
          <div className="relative mb-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome" className="pl-8" />
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
            {people.map((u) => (
              <div key={u.id} draggable={editor} onDragStart={dragStart({ uid: u.id, from: null })}
                className={cn("flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-sm", editor && "cursor-grab active:cursor-grabbing hover:bg-muted")}>
                {editor && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{u.full_name}</span>
                {(blocksOf.get(u.id) ?? 0) > 0 && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground" title="Blocos em que a pessoa está">{blocksOf.get(u.id)}</span>}
              </div>
            ))}
            {!people.length && <p className="p-2 text-xs text-muted-foreground">Ninguém encontrado.</p>}
          </div>
        </div>
        <div className="grid content-start gap-3 md:grid-cols-2">
          {ALCADAS.map((a) => {
            const ids = byBlock.get(a.key) ?? [];
            return (
              <div key={a.key}
                onDragOver={(e) => { if (editor) { e.preventDefault(); setOver(a.key); } }}
                onDragLeave={() => setOver((o) => (o === a.key ? null : o))}
                onDrop={(e) => void drop(a.key, e)}
                className={cn("panel flex min-h-36 flex-col p-3 transition-colors", over === a.key && "ring-2 ring-primary bg-primary/5", a.key === "compartilhada" && "md:col-span-2")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{a.title}</div>
                  <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{ids.length}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{a.desc}</p>
                <div className="mt-2 flex flex-1 flex-wrap content-start gap-1.5">
                  {ids.map((id) => (
                    <span key={id} draggable={editor} onDragStart={dragStart({ uid: id, from: a.key })}
                      className={cn("ov-fade inline-flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-2.5 pr-1 text-xs", editor && "cursor-grab active:cursor-grabbing")}>
                      {name.get(id) ?? "…"}
                      {editor && (
                        <button type="button" className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Tirar deste bloco"
                          onClick={() => set.mutate({ uid: id, alcada: a.key, on: false })}><X className="h-3 w-3" /></button>
                      )}
                    </span>
                  ))}
                  {!ids.length && <span className="text-xs text-muted-foreground">{editor ? "Arraste nomes para cá" : "Ninguém"}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

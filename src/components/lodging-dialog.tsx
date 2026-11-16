import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BedDouble, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAll } from "@/lib/results-engine";
import { titleCase } from "@/lib/fleet-notes";
import { LODGING_LABEL, lodgingOn, type Lodging, type LodgingStay } from "@/lib/lodging";

type Stay = LodgingStay & { id: string };
const LODGINGS: Lodging[] = ["americana", "mogi_guacu"];
const RULE: Record<Lodging, string> = {
  americana: "Na Suzano: sem VT e sem prêmio viagem. Nas outras obras, prêmio pela distância de Americana.",
  mogi_guacu: "Tratado como morador de Mogi Guaçu (VT e prêmio pela distância de Mogi Guaçu).",
};
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Alojamentos (botão na Programação): duas listas, Americana e Mogi Guaçu. Incluir, tirar (X) ou arrastar de uma lista
 * para a outra vale a partir do dia aberto na Programação; entrada e saída ficam guardadas sozinhas (lodging_stays).
 */
export function LodgingDialog({ date, open, onOpenChange, editable }: { date: string; open: boolean; onOpenChange: (o: boolean) => void; editable: boolean }) {
  const qc = useQueryClient();
  const [q, setQ] = useState<Record<Lodging, string>>({ americana: "", mogi_guacu: "" });
  const [over, setOver] = useState<Lodging | null>(null);
  const stays = useQuery({
    queryKey: ["lodging-stays", "all"],
    enabled: open,
    queryFn: async () => (await fetchAll<Stay>((a, b) => supabase.from("lodging_stays").select("id, collaborator_id, lodging, start_date, end_date").order("start_date").range(a, b))),
  });
  const people = useQuery({
    queryKey: ["lodging-people"],
    enabled: open,
    staleTime: 10 * 60_000,
    queryFn: async () => (await fetchAll<{ id: string; full_name: string }>((a, b) => supabase.from("collaborators").select("id, full_name").eq("status", "active").order("full_name").range(a, b))),
  });
  const nameOf = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, titleCase(p.full_name)])), [people.data]);
  const current = (id: string) => lodgingOn(stays.data ?? [], id, date);
  const activeStay = (id: string) => (stays.data ?? []).filter((s) => s.collaborator_id === id && s.start_date <= date && (!s.end_date || s.end_date >= date))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  const members = (l: Lodging) => [...new Set((stays.data ?? []).map((s) => s.collaborator_id))]
    .filter((id) => current(id) === l).sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "", "pt-BR"));

  const done = () => {
    qc.invalidateQueries({ queryKey: ["lodging-stays"] });
    qc.invalidateQueries({ queryKey: ["closing"] });
  };
  /** Encerra a estadia atual a partir do dia (ou apaga, se começou no próprio dia ou depois). */
  const endCurrent = async (id: string) => {
    const s = activeStay(id);
    if (!s) return;
    const { error } = s.start_date >= date
      ? await supabase.from("lodging_stays").delete().eq("id", s.id)
      : await supabase.from("lodging_stays").update({ end_date: addDays(date, -1) }).eq("id", s.id);
    if (error) throw error;
  };
  const put = useMutation({
    mutationFn: async ({ id, to }: { id: string; to: Lodging | null }) => {
      if (current(id) === to) return;
      await endCurrent(id);
      if (to) {
        const { error } = await supabase.from("lodging_stays").insert({ collaborator_id: id, lodging: to, start_date: date });
        if (error) throw error;
      }
    },
    onSuccess: (_, v) => { done(); setQ({ americana: "", mogi_guacu: "" }); toast.success(v.to ? `${nameOf.get(v.id) ?? "Colaborador"} no alojamento ${LODGING_LABEL[v.to]}` : `${nameOf.get(v.id) ?? "Colaborador"} saiu do alojamento`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const br = date.split("-").reverse().join("/");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Alojamentos</DialogTitle>
          <DialogDescription>Quem está alojado em {br}. Incluir, tirar ou arrastar de uma lista para a outra vale a partir de {br}; os dias anteriores não mudam.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {LODGINGS.map((l) => {
            const list = members(l);
            const term = plain(q[l].trim());
            const options = term.length >= 2
              ? (people.data ?? []).filter((p) => current(p.id) !== l && plain(p.full_name).includes(term)).slice(0, 8)
              : [];
            return (
              <section key={l}
                onDragOver={(e) => { if (editable) { e.preventDefault(); setOver(l); } }}
                onDragLeave={() => setOver((o) => (o === l ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/lodging"); if (id && editable) put.mutate({ id, to: l }); }}
                className={`flex min-h-64 flex-col gap-2 rounded-lg border p-3 transition-colors ${over === l ? "border-primary bg-primary/5" : "border-border"}`}>
                <div className="flex items-center gap-2">
                  <BedDouble className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">{LODGING_LABEL[l]}</h3>
                  <span className="ml-auto text-xs text-muted-foreground">{list.length} pessoa(s)</span>
                </div>
                <p className="text-xs text-muted-foreground">{RULE[l]}</p>
                {editable && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input className="pl-8" placeholder="Incluir: digite o nome" value={q[l]} aria-label={`Incluir no alojamento ${LODGING_LABEL[l]}`}
                      onChange={(e) => setQ((s) => ({ ...s, [l]: e.target.value }))} />
                    {options.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
                        {options.map((p) => {
                          const other = current(p.id);
                          return (
                            <li key={p.id}>
                              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent" onClick={() => put.mutate({ id: p.id, to: l })}>
                                <span className="truncate">{titleCase(p.full_name)}</span>
                                {other && <span className="ml-auto text-xs text-muted-foreground">sai de {LODGING_LABEL[other]}</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
                <ul className="grid gap-1">
                  {stays.isLoading ? <li className="text-sm text-muted-foreground">Carregando...</li>
                    : !list.length ? <li className="text-sm text-muted-foreground">Ninguém neste alojamento.</li>
                    : list.map((id) => (
                      <li key={id} draggable={editable} onDragStart={(e) => e.dataTransfer.setData("text/lodging", id)}
                        className={`flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm ${editable ? "cursor-grab" : ""}`}>
                        <span className="truncate">{nameOf.get(id) ?? "Colaborador"}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">desde {activeStay(id)?.start_date.split("-").reverse().join("/")}</span>
                        {editable && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Tirar ${nameOf.get(id) ?? ""} do alojamento`} onClick={() => put.mutate({ id, to: null })}>
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

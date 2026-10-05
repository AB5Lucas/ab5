import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DAYS, describeShift, type ShiftSchedule } from "@/lib/shifts";

export const Route = createFileRoute("/_authenticated/colaboradores/turnos")({
  head: () => ({
    meta: [
      { title: "Turnos | AB5 Hub" },
      { name: "description", content: "Turnos de trabalho dos colaboradores com horários por dia da semana." },
      { property: "og:title", content: "Turnos | AB5 Hub" },
      { property: "og:description", content: "Cadastro de turnos e vínculo de colaboradores." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

type Shift = { id: string; name: string; is_default: boolean; schedule: ShiftSchedule; active: boolean };

function Page() {
  const { canWrite } = useCurrentUser();
  const qc = useQueryClient();
  const shifts = useQuery({
    queryKey: ["work-shifts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("work_shifts").select("*").order("is_default", { ascending: false }).order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Shift[];
    },
  });
  const collabs = useQuery({
    queryKey: ["collabs-shift"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collaborators").select("id, full_name, registration_number, shift_id, positions(name)").eq("status", "active").order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const def = shifts.data?.find((s) => s.is_default);
  const countOf = (s: Shift) =>
    (collabs.data ?? []).filter((c) => (s.is_default ? !c.shift_id || c.shift_id === s.id : c.shift_id === s.id)).length;

  const [edit, setEdit] = useState<{ id?: string; name: string; schedule: ShiftSchedule; is_default?: boolean } | null>(null);
  const [members, setMembers] = useState<Shift | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["work-shifts"] });
    qc.invalidateQueries({ queryKey: ["collabs-shift"] });
    qc.invalidateQueries({ queryKey: ["ajuste-ponto"] });
  };

  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { toast.error("Informe o nome do turno"); return; }
    const payload = { name: edit.name.trim(), schedule: edit.schedule as any };
    const { error } = edit.id
      ? await supabase.from("work_shifts").update(payload).eq("id", edit.id)
      : await supabase.from("work_shifts").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Turno salvo");
    setEdit(null);
    refresh();
  };

  const remove = async (s: Shift) => {
    if (!confirm(`Excluir o turno ${s.name}? Os colaboradores voltam para o turno Padrão.`)) return;
    const { error } = await supabase.from("work_shifts").delete().eq("id", s.id);
    if (error) { toast.error(error.message); return; }
    refresh();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Turnos"
        description="Todo colaborador está no turno Padrão, a não ser que seja colocado em outro turno."
        actions={canWrite ? <Button onClick={() => setEdit({ name: "", schedule: {} })}><Plus className="mr-1 h-4 w-4" />Novo turno</Button> : undefined}
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Turno</TableHead>
              <TableHead>Horários</TableHead>
              <TableHead className="w-28">Colaboradores</TableHead>
              <TableHead className="w-36 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(shifts.data ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name} {s.is_default && <Badge variant="secondary" className="ml-1">Padrão</Badge>}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{describeShift(s.schedule)}</TableCell>
                <TableCell>{countOf(s)}</TableCell>
                <TableCell className="text-right">
                  {!s.is_default && (
                    <Button size="icon" variant="ghost" title="Colaboradores" onClick={() => setMembers(s)}><Users className="h-4 w-4" /></Button>
                  )}
                  {canWrite && (
                    <Button size="icon" variant="ghost" title="Editar" onClick={() => setEdit({ id: s.id, name: s.name, schedule: { ...s.schedule }, is_default: s.is_default })}><Pencil className="h-4 w-4" /></Button>
                  )}
                  {canWrite && !s.is_default && (
                    <Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(s)}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{edit?.id ? "Editar turno" : "Novo turno"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ex.: Noturno" />
              </div>
              <p className="text-xs text-muted-foreground">Se a saída for menor que a entrada, o turno termina no dia seguinte.</p>
              {DAYS.map((d) => {
                const v = edit.schedule[d.key];
                return (
                  <div key={d.key} className="flex items-center gap-2">
                    <label className="flex w-28 items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!v}
                        onCheckedChange={(c) => {
                          const sc = { ...edit.schedule };
                          if (c) sc[d.key] = { start: "07:00", end: "17:00" };
                          else delete sc[d.key];
                          setEdit({ ...edit, schedule: sc });
                        }}
                      />
                      {d.label}
                    </label>
                    {v ? (
                      <>
                        <Input type="time" className="w-28" value={v.start} onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, [d.key]: { ...v, start: e.target.value } } })} />
                        <span className="text-sm">às</span>
                        <Input type="time" className="w-28" value={v.end} onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, [d.key]: { ...v, end: e.target.value } } })} />
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">Folga</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter><Button onClick={save}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {members && (
        <MembersDialog
          shift={members}
          canWrite={canWrite}
          collabs={collabs.data ?? []}
          onClose={() => setMembers(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function MembersDialog({ shift, canWrite, collabs, onClose, onSaved }: { shift: Shift; canWrite: boolean; collabs: any[]; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return collabs
      .filter((c) => !t || c.full_name.toLowerCase().includes(t) || (c.registration_number ?? "").includes(t) || (c.positions?.name ?? "").toLowerCase().includes(t))
      .sort((a, b) => Number(b.shift_id === shift.id) - Number(a.shift_id === shift.id));
  }, [q, collabs, shift.id]);

  const toggle = async (c: any, on: boolean) => {
    setBusy(c.id);
    const { error } = await supabase.from("collaborators").update({ shift_id: on ? shift.id : null }).eq("id", c.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Colaboradores — {shift.name}</DialogTitle></DialogHeader>
        <Input placeholder="Buscar por nome, matrícula ou função" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {list.map((c) => {
            const inThis = c.shift_id === shift.id;
            const other = c.shift_id && !inThis;
            return (
              <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                <Checkbox disabled={!canWrite || busy === c.id} checked={inThis} onCheckedChange={(v) => toggle(c, !!v)} />
                <span className="flex-1">{c.full_name} <span className="text-muted-foreground">· {c.positions?.name ?? "—"}</span></span>
                {other && <Badge variant="outline">outro turno</Badge>}
              </label>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateDeadlineSettings } from "@/lib/notifications";

/** Configuração global dos avisos de prazo das SCs (só admin grava; a RLS garante). */
export function NotificationSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () => (await supabase.from("notification_settings").select("advance_days, urgent_days").eq("id", 1).maybeSingle()).data,
  });
  const [v, setV] = useState({ advanceDays: "5", urgentDays: "2" });
  useEffect(() => { if (q.data) setV({ advanceDays: String(q.data.advance_days), urgentDays: String(q.data.urgent_days) }); }, [q.data]);
  const parsed = { advanceDays: Number(v.advanceDays), urgentDays: Number(v.urgentDays) };
  const error = validateDeadlineSettings(parsed);
  const save = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.from("notification_settings")
        .update({ advance_days: parsed.advanceDays, urgent_days: parsed.urgentDays, updated_at: new Date().toISOString(), updated_by: user?.id ?? null }).eq("id", 1);
      if (e) throw e;
    },
    onSuccess: () => { toast.success("Prazos das notificações salvos"); qc.invalidateQueries({ queryKey: ["notification-settings"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="panel space-y-3 p-4">
      <div>
        <h2 className="font-display text-lg uppercase tracking-wide">Notificações de prazo das SCs</h2>
        <p className="text-sm text-muted-foreground">
          Validador e compradores recebem um aviso por nível, uma vez por SC: Antecedência (faltando até X dias), Urgente (até Y dias, inclusive no dia do prazo) e Atrasado (prazo vencido). Para quando a SC sai da etapa, é comprada ou cancelada.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="ns-adv">Antecedência (dias)</Label>
          <Input id="ns-adv" type="number" min={1} max={60} className="w-32" value={v.advanceDays} disabled={!canEdit} onChange={(e) => setV({ ...v, advanceDays: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ns-urg">Urgente (dias)</Label>
          <Input id="ns-urg" type="number" min={0} max={30} className="w-32" value={v.urgentDays} disabled={!canEdit} onChange={(e) => setV({ ...v, urgentDays: e.target.value })} />
        </div>
        {canEdit && <Button onClick={() => save.mutate()} disabled={!!error || save.isPending}>Salvar</Button>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!canEdit && <p className="text-xs text-muted-foreground">Só o administrador altera.</p>}
    </div>
  );
}

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Acompanhamento de um item vencido ou a vencer: já agendado, em conferência ou pendente (precisa de ação). */
export type FollowUp = "all" | "scheduled" | "conference" | "pending";

/** O filtro só vale quando o status filtrado é "a vencer" ou "vencido". */
export const followUpApplies = (status: string) => status === "expiring" || status === "expired";

export function matchesFollowUp(filter: FollowUp, key: string, scheduled: { has: (k: string) => boolean }, inConf: { has: (k: string) => boolean }) {
  if (filter === "all") return true;
  if (filter === "scheduled") return scheduled.has(key);
  if (filter === "conference") return inConf.has(key);
  return !scheduled.has(key) && !inConf.has(key);
}

export function FollowUpFilter({ value, onChange }: { value: FollowUp; onChange: (v: FollowUp) => void }) {
  return (
    <div className="space-y-1">
      <Label>Acompanhamento</Label>
      <Select value={value} onValueChange={(v) => onChange(v as FollowUp)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos</SelectItem>
          <SelectItem value="scheduled">Agendados</SelectItem>
          <SelectItem value="conference">Em conferência</SelectItem>
          <SelectItem value="pending">Pendentes (sem agendamento)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

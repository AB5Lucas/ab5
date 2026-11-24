import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateBR } from "@/lib/scheduling";

type Pending = { id: string; next_check_date: string | null; sent_at: string | null };

async function pendingOnboarding(collaboratorId: string, clientId: string): Promise<Pending | null> {
  const { data, error } = await supabase
    .from("client_onboardings")
    .select("id, next_check_date, sent_at")
    .eq("collaborator_id", collaboratorId)
    .eq("client_id", clientId)
    .eq("status", "pendente")
    .limit(1);
  if (error) return null;
  return (data?.[0] as Pending | undefined) ?? null;
}

const text = (p: Pending) =>
  `Documentação deste colaborador ainda pendente em Novos Clientes neste cliente${p.next_check_date ? ` (próxima conferência ${formatDateBR(p.next_check_date)})` : ""}. O agendamento é permitido, mas o cliente pode recusar a integração.`;

/** Aviso (não bloqueia) ao agendar integração de quem tem Novos Clientes pendente no mesmo cliente. */
export function OnboardingPendingNotice({ collaboratorId, clientId }: { collaboratorId: string; clientId: string }) {
  const q = useQuery({
    queryKey: ["client-onboarding", "pending", collaboratorId, clientId],
    enabled: !!collaboratorId && !!clientId,
    queryFn: () => pendingOnboarding(collaboratorId, clientId),
  });
  if (!q.data) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs sm:col-span-2">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>{text(q.data)}</span>
    </div>
  );
}

/** Mesmo aviso em texto, para o toast depois de agendar (null = nada pendente). */
export async function onboardingPendingWarning(collaboratorId: string, clientId: string | null | undefined): Promise<string | null> {
  if (!collaboratorId || !clientId) return null;
  const p = await pendingOnboarding(collaboratorId, clientId);
  return p ? text(p) : null;
}

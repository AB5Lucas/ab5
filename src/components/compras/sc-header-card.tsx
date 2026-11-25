import type { ReactNode } from "react";
import { Pill, todayISO, type ScRow } from "@/components/compras/sc-shared";
import { STAGE_LABEL, brDate, deadlineControl, deliveryLabel, priorityClass, statusClass, type ScStage } from "@/lib/purchase-requests";

/** Cabeçalho da SC igual ao da página da solicitação (modelo FR-CPS-SC), para a Recomendação e a Aprovação. */
export function ScHeaderCard({ r, clientName }: { r: ScRow; clientName: Map<string, string> }) {
  const dl = deadlineControl(r, todayISO());
  const cName = r.client_id ? clientName.get(r.client_id) ?? "—" : "—";
  const created = new Date(r.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const cols: [string, ReactNode][][] = [
    [["Data da SC", brDate(r.request_date)], ["Horário", created], ["Requisitante", r.requester_name]],
    [["Categoria", r.category ?? "—"], ["Natureza da compra", r.nature ?? "—"], ["Prioridade", r.priority ? <Pill key="p" className={priorityClass(r.priority)}>{r.priority}</Pill> : "—"]],
    [["Cliente", cName], ["Prazo de entrega", brDate(r.due_date)], ["Local de entrega", deliveryLabel(r, cName)]],
    [
      ["Envio", r.sent_at ? new Date(r.sent_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "não enviado"],
      ["Controle de prazo", <Pill key="d" className={dl.cls}>{dl.label}</Pill>],
      ["Etapa / status", <span key="s" className="space-x-1">{STAGE_LABEL[r.stage as ScStage]} <Pill className={statusClass(r.status)}>{r.status}</Pill> <span className="text-xs text-muted-foreground">{brDate(r.status_at)}</span></span>],
    ],
  ];
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-border pb-2">
        <span className="text-sm font-semibold">Ab5 Indústria e Comércio LTDA</span>
        <span className="font-display text-sm uppercase tracking-wide">Solicitação de compras</span>
      </div>
      <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border">
        {cols.map((col, i) => (
          <dl key={i} className="space-y-2 lg:pl-4 lg:first:pl-0">
            {col.map(([k, v]) => <div key={k}><dt className="text-[11px] uppercase text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
          </dl>
        ))}
      </div>
      {r.justification && <p className="mt-3 rounded-md bg-muted p-2 text-xs"><b>Justificativa:</b> {r.justification}</p>}
      {r.notes && <p className="mt-3 rounded-md bg-muted p-2 text-xs"><b>Observações:</b> {r.notes}</p>}
      {r.approver_notes && <p className="mt-2 rounded-md bg-muted p-2 text-xs"><b>Validador:</b> {r.approver_notes}</p>}
      {r.buyer_notes && <p className="mt-2 rounded-md bg-muted p-2 text-xs"><b>Comprador:</b> {r.buyer_notes}</p>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Devolver a SC (Comprador): ao validador (volta à Validação) ou ao solicitante (rascunho), com motivo. */
export function ReturnScDialog({ sc, onClose, onDone }: { sc: { id: string; number: string } | null; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<"validador" | "solicitante">("validador");
  useEffect(() => { if (sc) { setReason(""); setTarget("validador"); } }, [sc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const giveBack = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("purchase_request_return", { _id: sc!.id, _notes: reason, _target: target });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(target === "validador" ? "Devolvida ao validador" : "Devolvida ao solicitante");
      qc.invalidateQueries({ queryKey: ["sc-requests"] }); qc.invalidateQueries({ queryKey: ["sc-request", sc!.id] });
      onClose(); onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={!!sc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Devolver a SC</DialogTitle>
          <DialogDescription>{sc?.number}. Para quem ela volta?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Devolver para">
          {([["validador", "Validador", "Volta para a Validação: o validador revisa e valida de novo."], ["solicitante", "Solicitante", "Volta para rascunho: o solicitante edita e envia de novo."]] as const).map(([v, l, d]) => (
            <button key={v} type="button" role="radio" aria-checked={target === v} onClick={() => setTarget(v)}
              className={`rounded-md border p-3 text-left text-sm ${target === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
              <div className="font-medium">{l}</div>
              <div className="text-xs text-muted-foreground">{d}</div>
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="ret-notes">Motivo da devolução</Label>
          <Textarea id="ret-notes" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={giveBack.isPending || !reason.trim()} onClick={() => giveBack.mutate()}>Devolver</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invalidateScheduleDay } from "@/lib/invalidate-day";

/** Erro de chave única (23505): outro usuário gravou a mesma pessoa/dia entre a leitura e a gravação. */
export function isDuplicateError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "23505" || /duplicate key|23505/i.test(String(err?.message ?? ""));
}

export const CONCURRENT_EDIT_MESSAGE = "Outro usuário acabou de alterar o dia, atualizando…";

/** Erro de gravação da Programação: duplicidade vira aviso + releitura do dia; o resto mostra a mensagem. */
export function scheduleWriteError(qc: QueryClient, e: unknown) {
  if (isDuplicateError(e)) {
    toast.info(CONCURRENT_EDIT_MESSAGE);
    invalidateScheduleDay(qc);
    return;
  }
  toast.error((e as { message?: string } | null)?.message ?? "Erro ao gravar");
}

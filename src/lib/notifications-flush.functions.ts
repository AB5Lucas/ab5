import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Envia na hora o que está na fila de notificações (push/e-mail/WhatsApp), sem esperar a rodada de 10 min do job.
 * Chamado pela tela logo depois de uma gravação em Compras (router.tsx). Só envia o que já está na fila — as
 * notificações nascem apenas dos gatilhos de Compras no banco —, então qualquer usuário logado pode disparar.
 */
export const flushNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const origin = (process.env["APP_PUBLIC_URL"] ?? "").trim().replace(/\/+$/, "") || "https://ab5.lovable.app";
    const { processDeliveries } = await import("./notifications.server");
    try {
      return await processDeliveries(origin, 50);
    } catch (e) {
      console.error("flushNotifications", e);
      return {};
    }
  });

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const appOrigin = () => (process.env["APP_PUBLIC_URL"] ?? "").trim().replace(/\/+$/, "") || new URL(getRequest().url).origin;

/** Canais configurados no servidor e a chave pública do Web Push (para a tela de preferências). */
export const getNotificationChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { channelsConfigured, vapidKeys } = await import("./notification-channels.server");
    return { configured: channelsConfigured(), vapidPublicKey: vapidKeys()?.publicKey ?? null };
  });

/** Cria uma notificação de teste para o próprio usuário e já processa a fila de envio. */
export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: id, error } = await context.supabase.rpc("notification_send_test");
    if (error) throw new Error(error.message);
    const { processDeliveries } = await import("./notifications.server");
    await processDeliveries(appOrigin(), 50);
    if (!id) return { deliveries: [] as { channel: string; status: string; error: string | null }[], repeated: true };
    const { data } = await context.supabase.from("notification_deliveries").select("channel, status, error").eq("notification_id", id);
    return { deliveries: data ?? [], repeated: false };
  });

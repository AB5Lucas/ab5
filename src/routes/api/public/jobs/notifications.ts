import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Job de notificações (agendar a cada 10–15 min): prazos das SCs, envio por push/e-mail/WhatsApp e resumo diário.
export const Route = createFileRoute("/api/public/jobs/notifications")({
  server: { handlers: { POST: async ({ request }) => {
    const failure = await authenticateCronRequest(request);
    if (failure) return failure;
    const origin = (process.env["APP_PUBLIC_URL"] ?? "").trim().replace(/\/+$/, "") || new URL(request.url).origin;
    const { runNotificationJob } = await import("@/lib/notifications.server");
    try {
      return Response.json(await runNotificationJob(origin));
    } catch (e) {
      console.error("Notification job failed", e);
      return Response.json({ error: "Notification job failed" }, { status: 503 });
    }
  } } },
});

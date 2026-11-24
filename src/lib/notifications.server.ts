/**
 * Processamento no servidor (job /api/public/jobs/notifications): prazos das SCs, fila de envio
 * (push/e-mail/WhatsApp) e resumo diário pelo WhatsApp. Idempotente: pode rodar a cada 10–15 min.
 */
import { buildDigest, notificationText, todayBrasilia, type DigestRow } from "./notifications";
import { sendEmail, sendWhatsApp, vapidKeys, type SendResult } from "./notification-channels.server";

const MAX_ATTEMPTS = 3;

export async function runNotificationJob(origin: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const deadlines = await supabaseAdmin.rpc("purchase_notify_deadlines");
  if (deadlines.error) console.error("purchase_notify_deadlines", deadlines.error);
  const deliveries = await processDeliveries(origin);
  const digests = await processDigests();
  return { deadlines: deadlines.data ?? 0, deliveries, digests };
}

export async function processDeliveries(origin: string, limit = 200) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin.rpc("notification_deliveries_claim", { _limit: limit });
  if (error) throw new Error(error.message);
  const list = rows ?? [];
  const keys = vapidKeys();
  const pushUsers = [...new Set(list.filter((r) => r.channel === "push").map((r) => r.user_id))];
  const subs = keys && pushUsers.length
    ? ((await supabaseAdmin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", pushUsers)).data ?? [])
    : [];
  const counts: Record<string, number> = {};
  const one = async (r: (typeof list)[number]): Promise<SendResult> => {
    const url = r.link ? new URL(r.link, origin).toString() : null;
    if (r.channel === "email") return sendEmail(r.email, r, url);
    if (r.channel === "whatsapp") return sendWhatsApp(r.phone, notificationText(r, url));
    if (!keys) return { status: "skipped_no_config", error: "VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas" };
    const mine = subs.filter((s) => s.user_id === r.user_id);
    if (!mine.length) return { status: "skipped_no_target", error: "Nenhum navegador/celular inscrito" };
    const { sendWebPush } = await import("./web-push.server");
    const payload = { title: r.title, body: [r.ref, r.body].filter(Boolean).join(" · "), url: r.link ?? "/notificacoes", tag: r.id };
    const res = await Promise.all(mine.map((s) => sendWebPush(s, payload, keys).catch((e) => ({ ok: false, gone: false, status: 0, error: (e as Error).message }))));
    const gone = mine.filter((_, k) => res[k]?.gone).map((s) => s.id);
    if (gone.length) await supabaseAdmin.from("push_subscriptions").delete().in("id", gone);
    const okIds = mine.filter((_, k) => res[k]?.ok).map((s) => s.id);
    if (okIds.length) {
      await supabaseAdmin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).in("id", okIds);
      return { status: "sent" };
    }
    if (gone.length === mine.length) return { status: "skipped_no_target", error: "Inscrições vencidas (removidas)" };
    return { status: "failed", error: res.map((x) => x.error).filter(Boolean).join("; ").slice(0, 300) };
  };
  for (let i = 0; i < list.length; i += 10) {
    await Promise.all(list.slice(i, i + 10).map(async (r) => {
      const out = await one(r).catch((e): SendResult => ({ status: "failed", error: (e as Error).message }));
      const retry = out.status === "failed" && r.attempts < MAX_ATTEMPTS;
      const now = new Date();
      await supabaseAdmin.from("notification_deliveries").update({
        status: retry ? "pending" : out.status,
        error: out.error ?? null,
        sent_at: out.status === "sent" ? now.toISOString() : null,
        locked_until: retry ? new Date(now.getTime() + r.attempts * 10 * 60_000).toISOString() : null,
        updated_at: now.toISOString(),
      }).eq("id", r.id);
      const key = retry ? "retry" : out.status;
      counts[key] = (counts[key] ?? 0) + 1;
    }));
  }
  return counts;
}

/** Resumo diário pelo WhatsApp: grava o dia antes de mandar (nunca repete) e não envia vazio. */
export async function processDigests() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: due, error } = await supabaseAdmin.rpc("notification_digests_due");
  if (error) throw new Error(error.message);
  if (!due?.length) return {};
  const { data: cfg } = await supabaseAdmin.from("notification_settings").select("advance_days, urgent_days").eq("id", 1).maybeSingle();
  const settings = { advanceDays: cfg?.advance_days ?? 5, urgentDays: cfg?.urgent_days ?? 2 };
  const counts: Record<string, number> = {};
  for (const u of due) {
    const { data: rows } = await supabaseAdmin.rpc("notification_digest_rows", { _user: u.user_id });
    const text = buildDigest((rows ?? []) as DigestRow[], u.day ?? todayBrasilia(), { name: u.full_name, settings });
    // Reserva o dia (PK user_id+day): outra execução simultânea não manda de novo.
    const { data: claimed } = await supabaseAdmin.from("notification_digests")
      .upsert({ user_id: u.user_id, day: u.day, status: text ? "pending" : "empty", body: text }, { onConflict: "user_id,day", ignoreDuplicates: true })
      .select("user_id");
    if (!claimed?.length || !text) { if (!text) counts["empty"] = (counts["empty"] ?? 0) + 1; continue; }
    const out = await sendWhatsApp(u.phone, text);
    await supabaseAdmin.from("notification_digests").update({
      status: out.status, error: out.error ?? null, sent_at: out.status === "sent" ? new Date().toISOString() : null,
    }).eq("user_id", u.user_id).eq("day", u.day);
    counts[out.status] = (counts[out.status] ?? 0) + 1;
  }
  return counts;
}

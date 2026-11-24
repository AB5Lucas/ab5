/**
 * Canais de envio. Sem configuração (variáveis de ambiente) o canal NÃO simula envio: devolve skipped_no_config.
 * Variáveis (Lovable › Cloud › Secrets):
 *  - Push: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:ti@empresa.com.br)
 *  - E-mail (Resend): RESEND_API_KEY, NOTIFY_EMAIL_FROM (ex.: "AB5 Hub <avisos@dominio-verificado.com.br>")
 *  - WhatsApp, um dos dois:
 *      Z-API: ZAPI_INSTANCE_ID, ZAPI_TOKEN e, se a conta exigir, ZAPI_CLIENT_TOKEN
 *      Meta Cloud API: WHATSAPP_CLOUD_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_TEMPLATE (modelo aprovado com 1 variável no corpo),
 *        opcional WHATSAPP_TEMPLATE_LANG (padrão pt_BR)
 */
import { normalizeWhatsApp } from "./notifications";
import type { VapidKeys } from "./web-push.server";

export type SendResult = { status: "sent" | "failed" | "skipped_no_config" | "skipped_no_target"; error?: string };

const env = (k: string) => (process.env[k] ?? "").trim() || null;

export function vapidKeys(): VapidKeys | null {
  const publicKey = env("VAPID_PUBLIC_KEY"), privateKey = env("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env("VAPID_SUBJECT") ?? "mailto:nao-responda@ab5.com.br" };
}

export type WhatsAppProvider = "zapi" | "meta" | null;
export function whatsappProvider(): WhatsAppProvider {
  if (env("ZAPI_INSTANCE_ID") && env("ZAPI_TOKEN")) return "zapi";
  if (env("WHATSAPP_CLOUD_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID") && env("WHATSAPP_TEMPLATE")) return "meta";
  return null;
}

export function channelsConfigured() {
  return { push: !!vapidKeys(), email: !!(env("RESEND_API_KEY") && env("NOTIFY_EMAIL_FROM")), whatsapp: !!whatsappProvider() };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function sendEmail(to: string | null, n: { title: string; body: string | null; ref: string | null }, url: string | null): Promise<SendResult> {
  const key = env("RESEND_API_KEY"), from = env("NOTIFY_EMAIL_FROM");
  if (!key || !from) return { status: "skipped_no_config", error: "RESEND_API_KEY/NOTIFY_EMAIL_FROM não configurados" };
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { status: "skipped_no_target", error: "Usuário sem e-mail" };
  const subject = n.ref ? `${n.title} · ${n.ref}` : n.title;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p style="font-size:16px;font-weight:bold;margin:0 0 8px">${esc(n.title)}</p>
${n.ref ? `<p style="margin:0 0 4px;color:#555">${esc(n.ref)}</p>` : ""}
${n.body ? `<p style="margin:0 0 12px">${esc(n.body)}</p>` : ""}
${url ? `<p><a href="${esc(url)}" style="background:#111;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Abrir no AB5 Hub</a></p>` : ""}
<p style="color:#888;font-size:12px;margin-top:16px">Para mudar os canais, abra Notificações › Preferências no AB5 Hub.</p></div>`;
  const text = [n.title, n.ref, n.body, url].filter(Boolean).join("\n");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (res.ok) return { status: "sent" };
    return { status: "failed", error: `Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}` };
  } catch (e) {
    return { status: "failed", error: `Resend: ${(e as Error).message}` };
  }
}

export async function sendWhatsApp(phone: string | null, text: string): Promise<SendResult> {
  const provider = whatsappProvider();
  if (!provider) return { status: "skipped_no_config", error: "Provedor de WhatsApp não configurado (Z-API ou Meta Cloud API)" };
  const to = normalizeWhatsApp(phone);
  if (!to) return { status: "skipped_no_target", error: "Usuário sem WhatsApp válido" };
  try {
    let res: Response;
    if (provider === "zapi") {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const ct = env("ZAPI_CLIENT_TOKEN");
      if (ct) headers["Client-Token"] = ct;
      res = await fetch(`https://api.z-api.io/instances/${encodeURIComponent(env("ZAPI_INSTANCE_ID")!)}/token/${encodeURIComponent(env("ZAPI_TOKEN")!)}/send-text`, {
        method: "POST", headers, body: JSON.stringify({ phone: to, message: text }),
      });
    } else {
      // Meta: mensagem iniciada pela empresa só com modelo aprovado; o texto vai como a variável {{1}} do corpo.
      res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(env("WHATSAPP_PHONE_NUMBER_ID")!)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env("WHATSAPP_CLOUD_TOKEN")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: env("WHATSAPP_TEMPLATE"), language: { code: env("WHATSAPP_TEMPLATE_LANG") ?? "pt_BR" },
            // A Meta não aceita quebra de linha em variável de modelo.
            components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\s*\n+\s*/g, " | ").slice(0, 1000) }] }],
          },
        }),
      });
    }
    if (res.ok) return { status: "sent" };
    return { status: "failed", error: `${provider} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}` };
  } catch (e) {
    return { status: "failed", error: `${provider}: ${(e as Error).message}` };
  }
}

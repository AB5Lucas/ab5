/** Inscrição de Web Push neste navegador/celular (grava em push_subscriptions; a RLS deixa só o próprio usuário). */
import { supabase } from "@/integrations/supabase/client";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw-push.js", { scope: "/" });
}

/** Este aparelho já está inscrito? */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Pede permissão, inscreve e grava. Devolve mensagem de erro em português ou null. */
export async function subscribePush(vapidPublicKey: string): Promise<string | null> {
  if (!pushSupported()) return "Este navegador não aceita notificações push (no iPhone, instale o site na tela de início).";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "Permissão de notificação negada no navegador.";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) }));
  const j = sub.toJSON();
  const p256dh = j.keys?.["p256dh"], auth = j.keys?.["auth"];
  if (!j.endpoint || !p256dh || !auth) return "Inscrição inválida.";
  // O mesmo aparelho pode ter sido usado por outra pessoa: a função passa a inscrição para quem inscreveu agora.
  const { error } = await supabase.rpc("push_subscription_save", {
    _endpoint: j.endpoint, _p256dh: p256dh, _auth: auth, _ua: navigator.userAgent.slice(0, 300),
  });
  return error ? error.message : null;
}

export async function unsubscribePush(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  await sub.unsubscribe().catch(() => undefined);
}

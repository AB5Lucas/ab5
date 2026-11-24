import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Lock, Mail, MessageCircle, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_PREFS, validatePrefs, WEEK_DAYS, type NotificationPrefs } from "@/lib/notifications";
import { getNotificationChannels, sendTestNotification } from "@/lib/notifications.functions";
import { currentPushSubscription, pushSupported, subscribePush, unsubscribePush } from "@/lib/push-client";

const STATUS_LABEL: Record<string, string> = {
  sent: "enviado", pending: "na fila", failed: "falhou", skipped_no_config: "canal não configurado no servidor", skipped_no_target: "sem destino (telefone/e-mail/aparelho)",
};
const CHANNEL_LABEL: Record<string, string> = { push: "Push", email: "E-mail", whatsapp: "WhatsApp" };

/** Preferências do próprio usuário: app sempre ligado; Push/E-mail/WhatsApp (pelo menos um); resumo diário pelo WhatsApp. */
export function NotificationPrefsForm() {
  const { user } = useSession();
  const uid = user?.id;
  const qc = useQueryClient();
  const channelsFn = useServerFn(getNotificationChannels);
  const testFn = useServerFn(sendTestNotification);

  const prefs = useQuery({
    queryKey: ["notification-prefs", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [{ data: p, error }, { data: c }] = await Promise.all([
        supabase.from("notification_prefs").select("*").eq("user_id", uid!).maybeSingle(),
        supabase.rpc("notification_my_contact"),
      ]);
      if (error) throw error;
      return { prefs: p, contact: c?.[0] ?? null };
    },
  });
  const channels = useQuery({ queryKey: ["notification-channels"], queryFn: () => channelsFn(), staleTime: 300_000 });
  const [v, setV] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [pushHere, setPushHere] = useState<boolean | null>(null);
  useEffect(() => {
    const p = prefs.data?.prefs;
    if (p) setV({ ...p, digest_time: p.digest_time.slice(0, 5) });
  }, [prefs.data]);
  useEffect(() => { currentPushSubscription().then((s) => setPushHere(!!s)).catch(() => setPushHere(false)); }, []);

  const collabPhone = prefs.data?.contact?.collaborator_phone ?? null;
  const email = prefs.data?.contact?.email ?? user?.email ?? null;
  const error = validatePrefs(v, collabPhone);
  const cfg = channels.data?.configured;

  const save = useMutation({
    mutationFn: async (next: NotificationPrefs) => {
      const err = validatePrefs(next, collabPhone);
      if (err) throw new Error(err);
      const { error: e } = await supabase.from("notification_prefs").upsert({
        user_id: uid!, ...next, whatsapp_phone: next.whatsapp_phone?.trim() || null, updated_at: new Date().toISOString(),
      });
      if (e) throw new Error(e.message.includes("notification_prefs_one_channel") ? "Ligue pelo menos um canal além do aplicativo" : e.message);
    },
    onSuccess: () => { toast.success("Preferências salvas"); qc.invalidateQueries({ queryKey: ["notification-prefs"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePushHere = async (on: boolean) => {
    if (!on) { await unsubscribePush(); setPushHere(false); return; }
    const key = channels.data?.vapidPublicKey;
    if (!key) { toast.error("Push ainda não configurado no servidor (chaves VAPID)."); return; }
    const err = await subscribePush(key);
    if (err) toast.error(err);
    else { setPushHere(true); toast.success("Este aparelho vai receber notificações push"); }
  };

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (r) => {
      if (r.repeated) { toast.info("Teste já enviado neste minuto"); return; }
      const parts = r.deliveries.map((d) => `${CHANNEL_LABEL[d.channel] ?? d.channel}: ${STATUS_LABEL[d.status] ?? d.status}`);
      toast.success("Notificação de teste criada", { description: ["App: entregue", ...parts].join(" · ") });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof NotificationPrefs>(k: K, val: NotificationPrefs[K]) => setV((x) => ({ ...x, [k]: val }));
  const notConfigured = (on: boolean | undefined) => cfg && !on ? <span className="text-[11px] text-orange-600 dark:text-orange-400">Canal ainda não configurado no servidor: fica registrado, sem envio.</span> : null;

  if (prefs.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-4">
        <div>
          <h2 className="font-display text-lg uppercase tracking-wide">Canais</h2>
          <p className="text-sm text-muted-foreground">Você só recebe o que depende de você (SCs para validar, comprar, devolvidas, prazos). Escolha pelo menos um canal além do aplicativo.</p>
        </div>
        <ChannelRow icon={BellRing} title="No aplicativo (sino)" desc="Sempre ligado." checked disabled locked />
        <ChannelRow icon={Smartphone} title="Push (navegador/celular)" desc="Aviso do sistema mesmo com o AB5 Hub fechado." checked={v.push_enabled} onChange={(c) => set("push_enabled", c)} extra={
          <div className="space-y-1">
            {notConfigured(cfg?.push)}
            {v.push_enabled && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Switch checked={!!pushHere} onCheckedChange={togglePushHere} disabled={!pushSupported() || pushHere === null} />
                <span>{pushSupported() ? (pushHere ? "Este aparelho está inscrito" : "Receber push neste aparelho") : "Este navegador não aceita push"}</span>
              </div>
            )}
          </div>
        } />
        <ChannelRow icon={Mail} title="E-mail" desc={email ? `Para ${email}` : "E-mail do seu usuário"} checked={v.email_enabled} onChange={(c) => set("email_enabled", c)} extra={notConfigured(cfg?.email)} />
        <ChannelRow icon={MessageCircle} title="WhatsApp" desc="Mensagem para o seu WhatsApp." checked={v.whatsapp_enabled} onChange={(c) => set("whatsapp_enabled", c)} extra={notConfigured(cfg?.whatsapp)} />
        <div className="space-y-1 sm:max-w-xs">
          <Label htmlFor="wa-phone">WhatsApp (DDD + número)</Label>
          <Input id="wa-phone" inputMode="tel" placeholder={collabPhone ? `${collabPhone} (do cadastro)` : "(19) 99999-9999"} value={v.whatsapp_phone ?? ""} onChange={(e) => set("whatsapp_phone", e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{collabPhone ? "Vazio = telefone do seu cadastro de colaborador." : "Seu cadastro de colaborador não tem telefone: digite aqui."}</p>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg uppercase tracking-wide">Resumo diário pelo WhatsApp</h2>
            <p className="text-sm text-muted-foreground">Uma mensagem curta com as SCs que esperam por você, as próximas do vencimento e as atrasadas. Não é enviado quando não há nada. Independe do canal WhatsApp acima.</p>
          </div>
          <Switch checked={v.digest_enabled} onCheckedChange={(c) => set("digest_enabled", c)} aria-label="Resumo diário" />
        </div>
        {v.digest_enabled && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="block">Dias</Label>
              <div className="flex flex-wrap gap-1">
                {WEEK_DAYS.map((d, i) => {
                  const on = v.digest_days.includes(i);
                  return (
                    <Button key={d} type="button" size="sm" variant={on ? "default" : "outline"} className="h-8 w-11 px-0"
                      onClick={() => set("digest_days", on ? v.digest_days.filter((x) => x !== i) : [...v.digest_days, i].sort())}>{d}</Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="digest-time">Horário (Brasília)</Label>
              <Input id="digest-time" type="time" className="w-32" value={v.digest_time} onChange={(e) => set("digest_time", e.target.value)} />
            </div>
          </div>
        )}
        {v.digest_enabled && notConfigured(cfg?.whatsapp)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => save.mutate(v)} disabled={!!error || save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}><Send className="h-4 w-4" /> {test.isPending ? "Enviando…" : "Enviar teste"}</Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}

function ChannelRow({ icon: Icon, title, desc, checked, onChange, disabled, locked, extra }: {
  icon: typeof Mail; title: string; desc: string; checked: boolean; onChange?: (c: boolean) => void; disabled?: boolean; locked?: boolean; extra?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
        {extra}
      </div>
      <div className="flex items-center gap-1">
        {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
        <Switch checked={checked} onCheckedChange={(c) => onChange?.(c)} disabled={!!disabled} aria-label={title} />
      </div>
    </div>
  );
}

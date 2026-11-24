import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientImagePath, clientImagePrompt } from "./client-images";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_IMAGE_MODEL = "google/gemini-2.5-flash-image-preview";

/** Gera (ou refaz) a imagem da fachada do cliente pela IA da Lovable e grava no bucket client-images. */
export const generateClientImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("Cliente inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: canWrite } = await context.supabase.rpc("can_write");
    if (!canWrite) throw new Error("Sem permissão para alterar clientes");
    const { data: c, error } = await context.supabase.from("clients").select("id, name, address, number, neighborhood, city, state, notes").eq("id", data.clientId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!c) throw new Error("Cliente não encontrado");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("IA da Lovable indisponível (LOVABLE_API_KEY)");
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model: AI_IMAGE_MODEL, modalities: ["image", "text"], messages: [{ role: "user", content: clientImagePrompt(c) }] }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 402) throw new Error("Sem crédito de IA na Lovable");
      if (res.status === 429) throw new Error("Limite de uso da IA, tente em alguns minutos");
      throw new Error(`IA (${res.status}): ${body.slice(0, 200)}`);
    }
    const json: any = await res.json();
    const url: string | undefined = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    const m = url?.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!m) throw new Error("A IA não devolveu imagem");
    const bin = atob(m[2]!);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = clientImagePath(c.id);
    const up = await context.supabase.storage.from("client-images").upload(path, bytes, { contentType: m[1] ?? "image/png", upsert: true });
    if (up.error) throw new Error(up.error.message);
    const { data: old } = await context.supabase.from("clients").select("image_path").eq("id", c.id).maybeSingle();
    const upd = await context.supabase.from("clients").update({ image_path: path } as never).eq("id", c.id);
    if (upd.error) throw new Error(upd.error.message);
    if (old?.image_path && old.image_path !== path) await context.supabase.storage.from("client-images").remove([old.image_path]);
    return { path };
  });

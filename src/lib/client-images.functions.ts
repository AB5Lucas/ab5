import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientImagePath, photoCleanupPrompt, type ClientForImage, type ImageOrigin } from "./client-images";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_IMAGE_MODEL = "google/gemini-2.5-flash-image-preview";
const UA = "AB5Hub/1.0 (imagens de clientes)";

const toBase64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

async function download(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    const mime = (r.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!r.ok || !mime.startsWith("image/")) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    return bytes.length > 5_000 && bytes.length < 8_000_000 ? { bytes, mime } : null;
  } catch { return null; }
}

/**
 * Fotos do lugar no Google Maps (Places API New): procura pelo nome + endereço e pega a foto horizontal mais larga.
 * Precisa de GOOGLE_MAPS_API_KEY com a "Places API (New)" ativada. Devolve também o ponto, para o mapa dos clientes.
 */
async function placesPhoto(c: ClientForImage) {
  const key = process.env["GOOGLE_MAPS_API_KEY"];
  if (!key) return null;
  const textQuery = [c.name, [c.address, c.number].filter(Boolean).join(" "), c.city, c.state].filter(Boolean).join(", ");
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.displayName,places.location,places.photos" },
      body: JSON.stringify({ textQuery, languageCode: "pt-BR", regionCode: "BR", maxResultCount: 1 }),
    });
    const place = ((await r.json()) as any)?.places?.[0];
    if (!place) return null;
    const photos = [...(place.photos ?? [])].sort((a: any, b: any) => (b.widthPx / Math.max(1, b.heightPx)) - (a.widthPx / Math.max(1, a.heightPx)));
    for (const ph of photos.slice(0, 4)) {
      const img = await download(`https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=1600&key=${key}`);
      if (img) return { ...img, lat: place.location?.latitude as number | undefined, lon: place.location?.longitude as number | undefined };
    }
  } catch { /* sem foto */ }
  return null;
}

/** Busca de imagens do Google (Programmable Search), só se GOOGLE_CSE_KEY e GOOGLE_CSE_CX estiverem configurados. */
async function googleImage(c: ClientForImage) {
  const key = process.env["GOOGLE_CSE_KEY"], cx = process.env["GOOGLE_CSE_CX"];
  if (!key || !cx) return null;
  const q = `${c.name} ${[c.address, c.number].filter(Boolean).join(" ")} ${c.city ?? ""} fachada`.trim();
  try {
    const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&searchType=image&imgSize=large&num=6&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(15000) });
    const j: any = await r.json();
    for (const it of j?.items ?? []) { const img = await download(it.link); if (img) return img; }
  } catch { /* sem busca */ }
  return null;
}

/**
 * Gera (ou refaz) a imagem do cliente a partir de imagem real (foto de referência, busca do Google ou satélite);
 * a IA da Lovable só limpa/realça. Grava no bucket client-images e marca a origem.
 */
export const generateClientImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { clientId: string }) => {
    if (!d?.clientId || typeof d.clientId !== "string") throw new Error("Cliente inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: canWrite } = await context.supabase.rpc("can_write");
    if (!canWrite) throw new Error("Sem permissão para alterar clientes");
    const { data: c, error } = await context.supabase.from("clients").select("id, name, address, number, neighborhood, city, state, notes, image_path, image_source, image_source_kind").eq("id", data.clientId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!c) throw new Error("Cliente não encontrado");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("IA da Lovable indisponível (LOVABLE_API_KEY)");

    let src: { bytes: Uint8Array; mime: string } | null = null;
    let origin: ImageOrigin = "foto";
    let point: { lat?: number | undefined; lon?: number | undefined } = {};
    if (c.image_source) {
      if (/^https?:\/\//i.test(c.image_source)) src = await download(c.image_source);
      else {
        const f = await context.supabase.storage.from("client-images").download(c.image_source);
        if (f.data) src = { bytes: new Uint8Array(await f.data.arrayBuffer()), mime: f.data.type || "image/png" };
      }
    }
    if (!src) { const p = await placesPhoto(c); if (p) { src = p; origin = "maps"; point = { lat: p.lat, lon: p.lon }; } }
    if (!src) { src = await googleImage(c); origin = "busca"; }
    // Sem foto real não gera nada (nunca inventa): o quadro fica com o ícone até ter foto.
    if (!src) return { noSource: true as const, configured: !!(process.env["GOOGLE_MAPS_API_KEY"] || process.env["GOOGLE_CSE_KEY"]) };

    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({
        model: AI_IMAGE_MODEL, modalities: ["image", "text"],
        messages: [{ role: "user", content: [
          { type: "text", text: photoCleanupPrompt(c) },
          { type: "image_url", image_url: { url: `data:${src.mime};base64,${toBase64(src.bytes)}` } },
        ] }],
      }),
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
    // Sem imagem da IA, usa a própria imagem real.
    const outMime = m ? (m[1] ?? "image/png") : src.mime;
    let out = src.bytes;
    if (m) { const bin = atob(m[2]!); out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); }
    const path = clientImagePath(c.id);
    const up = await context.supabase.storage.from("client-images").upload(path, out, { contentType: outMime, upsert: true });
    if (up.error) throw new Error(up.error.message);
    const upd = await context.supabase.from("clients").update({ image_path: path, image_origin: origin, ...(point.lat != null && point.lon != null ? { lat: point.lat, lon: point.lon } : {}) } as never).eq("id", c.id);
    if (upd.error) throw new Error(upd.error.message);
    if (c.image_path && c.image_path !== path) await context.supabase.storage.from("client-images").remove([c.image_path]);
    return { path, origin, noSource: false as const };
  });

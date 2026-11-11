import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import { normalizePlate } from "./fleet-costs";
import { baseFolderPath, parseFuelXml, pickMonthFolder, type FuelNoteRow } from "./fleet-notes";

type Credentials = { lovableKey: string; excelKey: string };
type Item = { id: string; name: string; folder?: unknown; file?: unknown; lastModifiedDateTime?: string };
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const GRAPH = "https://graph.microsoft.com/v1.0";

async function children(path: string, c: Credentials): Promise<Item[]> {
  const out: Item[] = [];
  let next: string | null = `${DRIVE}/root:/${enc(path)}:/children?$select=id,name,folder,file,lastModifiedDateTime&$top=999`;
  while (next) {
    const page: any = await graph(next, c);
    out.push(...((page?.value ?? []) as Item[]));
    const link = page?.["@odata.nextLink"] as string | undefined;
    next = link ? link.replace(GRAPH, "") : null;
  }
  return out;
}

/** Pasta do mês dentro da pasta configurada; se houver uma subpasta do ano, procura dentro dela. */
async function monthFolder(base: string, ym: string, c: Credentials): Promise<string | null> {
  const level = (await children(base, c)).filter((i) => i.folder);
  const hit = pickMonthFolder(level, ym);
  if (hit) return `${base}/${hit.name}`;
  const year = level.find((i) => i.name.trim() === ym.slice(0, 4));
  if (!year) return null;
  const inner = pickMonthFolder((await children(`${base}/${year.name}`, c)).filter((i) => i.folder), ym);
  return inner ? `${base}/${year.name}/${inner.name}` : null;
}

async function setting(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("fleet_settings").select("value").eq("key", key).maybeSingle();
  return data?.value?.trim() || null;
}

async function pool<T, R>(list: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]!); }
  }));
  return out;
}

/**
 * Lê as pastas do mês: cada XML vira um abastecimento (só baixa os novos ou alterados) e a pasta de
 * notas vira a lista para conferência. A conferência automática é feita no banco (fleet_fuel_notes_sync).
 */
export async function executeFleetNotesSync(ym: string, c: Credentials) {
  const xmlBase = await setting("xml_folder");
  const notesBase = await setting("notes_folder");
  if (!xmlBase) throw new Error("Informe a pasta dos XML do posto (botão Pastas).");
  const xmlDir = await monthFolder(baseFolderPath(xmlBase), ym, c);
  if (!xmlDir) throw new Error(`Não achei a pasta de ${ym} dentro de ${baseFolderPath(xmlBase)}.`);
  const files = (await children(xmlDir, c)).filter((i) => i.file && /\.xml$/i.test(i.name));

  const { data: known } = await supabaseAdmin.from("fleet_fuel_notes")
    .select("access_key, xml_file, issued_at, nf_number, issuer, plate, km, driver, fuel, quantity, unit_price, total, info, synced_at").eq("ref_month", ym);
  const byFile = new Map((known ?? []).map((k) => [k.xml_file, k]));
  const errors: string[] = [];
  const rows = (await pool(files, 6, async (f): Promise<FuelNoteRow | null> => {
    const old = byFile.get(f.name);
    if (old && f.lastModifiedDateTime && Date.parse(old.synced_at) >= Date.parse(f.lastModifiedDateTime)) {
      const { synced_at: _s, ...rest } = old;
      return rest as FuelNoteRow;
    }
    try {
      const buf: ArrayBuffer = await graph(`${DRIVE}/items/${f.id}/content`, c, true);
      const row = parseFuelXml(new TextDecoder("utf-8").decode(buf), f.name);
      if (!row) errors.push(`${f.name}: não é uma NF-e`);
      return row;
    } catch (err) {
      errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      return old ? (({ synced_at: _s, ...rest }) => rest as FuelNoteRow)(old) : null;
    }
  })).filter((r): r is FuelNoteRow => !!r);
  const unique = [...new Map(rows.map((r) => [r.access_key, r])).values()];

  let docs: { id: string; name: string }[] = [];
  let notesDir: string | null = null;
  if (notesBase) {
    notesDir = await monthFolder(baseFolderPath(notesBase), ym, c);
    if (notesDir) docs = (await children(notesDir, c)).filter((i) => i.file).map((i) => ({ id: i.id, name: i.name }));
    else errors.push(`Não achei a pasta de notas de ${ym} dentro de ${baseFolderPath(notesBase)}.`);
  } else errors.push("Pasta das notas ainda não informada: todas as linhas ficam sem nota.");

  // Sem ligação pela hora da foto (os motoristas mandam as fotos em lote e a hora erra: nov/2026, 17 de 30).
  // A IA lê o que está escrito em cada foto ainda não lida; a ligação é feita no banco pelo nº da NF/chave.
  const { data: readDocs } = await supabaseAdmin.from("fleet_note_docs").select("file_name, read_at").eq("ref_month", ym);
  const alreadyRead = new Set((readDocs ?? []).filter((d) => d.read_at).map((d) => d.file_name));
  const toRead = docs.filter((d) => !alreadyRead.has(d.name) && IMAGE.test(d.name)).slice(0, READ_LIMIT);
  const readings = new Map<string, PhotoReading>();
  if (toRead.length) {
    await pool(toRead, 4, async (d) => {
      try { readings.set(d.name, await readPhoto(d.id, d.name, c)); }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Leitura da foto ${d.name}: ${msg}`);
        if (/402|429|crédito|credit/i.test(msg)) return; // sem crédito ou limite: tenta de novo na próxima leitura
        readings.set(d.name, { read_nf: null, read_key: null, read_plate: null, read_total: null, read_error: msg.slice(0, 300) });
      }
    });
  }
  const pendingRead = docs.filter((d) => !alreadyRead.has(d.name) && IMAGE.test(d.name)).length - readings.size;
  const now = new Date().toISOString();
  const docPayload = docs.map((d) => { const r = readings.get(d.name); return r ? { ...d, ...r, read_at: now } : d; });
  const payload = unique.map((u) => ({ ...u, doc_guess: null }));

  const { data: n, error } = await supabaseAdmin.rpc("fleet_fuel_notes_sync", { p_month: ym, p_notes: JSON.parse(JSON.stringify(payload)), p_docs: JSON.parse(JSON.stringify(docPayload)) });
  if (error) throw error;
  if (pendingRead > 0) errors.unshift(`Faltam ler ${pendingRead} foto(s): clique em Ler pastas de novo.`);
  return { xmlDir, notesDir, xml: files.length, saved: n as number, docs: docs.length, photosRead: readings.size, errors: errors.slice(0, 20) };
}

// ---------- Leitura das fotos das notas (IA da Lovable) ----------
const IMAGE = /\.(jpe?g|png|webp)$/i;
const READ_LIMIT = 40;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const toBase64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
type PhotoReading = { read_nf: string | null; read_key: string | null; read_plate: string | null; read_total: number | null; read_error: string | null };

const PROMPT = `Esta foto deve ser um cupom de abastecimento (DANFE simplificado / NFC-e) de um posto de combustível.
Leia e devolva SOMENTE um JSON, sem texto em volta, no formato:
{"nf": "número da NF (campo NF, só dígitos)", "chave": "chave de acesso com 44 dígitos, só dígitos", "placa": "placa do veículo", "total": valor total em reais como número (ex.: 1434.98)}
Regras: use null em qualquer campo cortado, borrado ou ilegível — nunca complete dígitos que você não consegue ler.
Se a foto não for um cupom de abastecimento, devolva {"nf": null, "chave": null, "placa": null, "total": null}.`;

async function readPhoto(itemId: string, name: string, c: Credentials): Promise<PhotoReading> {
  const buf: ArrayBuffer = await graph(`${DRIVE}/items/${itemId}/content`, c, true);
  const mime = /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
  const b64 = toBase64(new Uint8Array(buf));
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.lovableKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 402) throw new Error("402: sem crédito de IA na Lovable");
    if (res.status === 429) throw new Error("429: limite de uso da IA, tente mais tarde");
    throw new Error(`IA (${res.status}): ${body.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return parsePhotoReading(String(data?.choices?.[0]?.message?.content ?? ""));
}

/** Resposta da IA → campos da leitura (aceita o JSON dentro de ```json ... ```). */
export function parsePhotoReading(text: string): PhotoReading {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { read_nf: null, read_key: null, read_plate: null, read_total: null, read_error: "resposta sem JSON" };
  let o: any;
  try { o = JSON.parse(json); } catch { return { read_nf: null, read_key: null, read_plate: null, read_total: null, read_error: "JSON inválido" }; }
  const digits = (v: unknown) => (v == null ? null : String(v).replace(/\D/g, "") || null);
  const nf = digits(o.nf);
  const key = digits(o.chave);
  const raw = o.total == null ? null : String(o.total).replace(/[^\d.,]/g, "");
  const total = typeof o.total === "number" ? o.total : !raw ? null : raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
  const plate = o.placa ? normalizePlate(o.placa) : null;
  return {
    read_nf: nf && nf.length >= 3 && nf.length <= 9 ? nf : null,
    read_key: key && key.length === 44 ? key : null,
    read_plate: plate && /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate) ? plate : null,
    read_total: total != null && Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : null,
    read_error: null,
  };
}

/** Miniaturas das notas (fotos) da pasta do mês, para conferir e atribuir na tela; os links valem por pouco tempo. */
export async function noteThumbnails(ym: string, c: Credentials): Promise<{ name: string; small: string | null; large: string | null }[]> {
  const notesBase = await setting("notes_folder");
  if (!notesBase) return [];
  const dir = await monthFolder(baseFolderPath(notesBase), ym, c);
  if (!dir) return [];
  const out: { name: string; small: string | null; large: string | null }[] = [];
  let next: string | null = `${DRIVE}/root:/${enc(dir)}:/children?$expand=thumbnails&$top=999`;
  while (next) {
    const page: any = await graph(next, c);
    for (const i of (page?.value ?? []) as any[]) {
      if (!i.file) continue;
      const t = i.thumbnails?.[0];
      out.push({ name: i.name, small: t?.medium?.url ?? t?.small?.url ?? null, large: t?.large?.url ?? t?.medium?.url ?? null });
    }
    const link = page?.["@odata.nextLink"] as string | undefined;
    next = link ? link.replace(GRAPH, "") : null;
  }
  return out;
}

/** Link para abrir um arquivo da pasta de notas no SharePoint. */
export async function noteFileUrl(itemId: string, c: Credentials): Promise<string | null> {
  const item: any = await graph(`${DRIVE}/items/${itemId}?$select=webUrl`, c);
  return item?.webUrl ?? null;
}

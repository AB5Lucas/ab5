import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import { baseFolderPath, matchPhotosByTime, parseFuelXml, pickMonthFolder, type FuelNoteRow } from "./fleet-notes";

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
    .select("access_key, xml_file, issued_at, nf_number, issuer, plate, km, driver, fuel, quantity, unit_price, total, info, synced_at, note_file, note_match").eq("ref_month", ym);
  const byFile = new Map((known ?? []).map(({ note_file: _f, note_match: _m, ...k }) => [k.xml_file, k]));
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

  // Fotos das notas (nome com data e hora): sugere a foto de cada abastecimento pela hora, sem mexer nas atribuídas à mão.
  const manual = new Map((known ?? []).filter((k) => k.note_match === "manual" && k.note_file).map((k) => [k.access_key, k.note_file!]));
  const taken = new Set(manual.values());
  const byTime = matchPhotosByTime(unique.filter((u) => !manual.has(u.access_key)).map((u) => ({ key: u.access_key, issued_at: u.issued_at })), docs.map((d) => d.name).filter((d) => !taken.has(d)));
  const payload = unique.map((u) => ({ ...u, doc_guess: byTime.get(u.access_key) ?? null }));

  const { data: n, error } = await supabaseAdmin.rpc("fleet_fuel_notes_sync", { p_month: ym, p_notes: JSON.parse(JSON.stringify(payload)), p_docs: JSON.parse(JSON.stringify(docs)) });
  if (error) throw error;
  return { xmlDir, notesDir, xml: files.length, saved: n as number, docs: docs.length, errors: errors.slice(0, 20) };
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

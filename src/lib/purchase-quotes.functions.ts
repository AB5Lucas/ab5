import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { bestScItem, parseQuoteReading, QUOTE_PROMPT, suggestConversion } from "./purchase-quotes";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const toBase64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

async function askAi(key: string, content: unknown[]): Promise<string> {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model: AI_MODEL, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 402) throw new Error("Sem crédito de IA na Lovable");
    if (res.status === 429) throw new Error("Limite de uso da IA, tente de novo em instantes");
    throw Object.assign(new Error(`IA (${res.status}): ${body.slice(0, 200)}`), { status: res.status });
  }
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? "");
}

/**
 * Lê uma cotação (PDF, foto ou Excel) com a IA da Lovable e grava fornecedor, condições e itens; cada item já vem
 * ligado ao item da SC indicado pela IA (ou pela semelhança da descrição) com o fator de conversão sugerido.
 * Usa a sessão do usuário: a RLS só deixa o comprador gravar.
 */
export const readPurchaseQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { quoteId: string }) => {
    if (!d?.quoteId || typeof d.quoteId !== "string") throw new Error("Cotação inválida");
    return d;
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const key = process.env["LOVABLE_API_KEY"];
    const { data: q, error } = await sb.from("purchase_quotes").select("id, request_id, file_path, file_name, kind").eq("id", data.quoteId).maybeSingle();
    if (error) throw error;
    if (!q) throw new Error("Cotação não encontrada");
    const fail = async (msg: string) => {
      await sb.from("purchase_quotes").update({ read_status: "erro", read_error: msg.slice(0, 500) }).eq("id", q.id);
      return { ok: false as const, error: msg };
    };
    if (!key) return fail("IA não configurada (LOVABLE_API_KEY)");
    const { data: items } = await sb.from("purchase_request_items").select("id, item_no, quantity, unit, description").eq("request_id", q.request_id).order("item_no");
    const scItems = items ?? [];
    const list = scItems.map((i) => `${i.item_no}. ${i.quantity} ${i.unit} - ${i.description}`).join("\n") || "(sem itens)";
    const prompt = QUOTE_PROMPT(list);
    let text: string;
    // Cotação por link (página do produto/loja): lê o texto da página e manda para a IA.
    if (q.kind === "link" || /^https?:\/\//i.test(q.file_path)) {
      try {
        const page = await fetch(q.file_path, { headers: { "User-Agent": "Mozilla/5.0 (AB5Hub cotacao)", Accept: "text/html,application/pdf,*/*" }, signal: AbortSignal.timeout(20000), redirect: "follow" });
        if (!page.ok) return fail(`Link não abriu (${page.status})`);
        const type = page.headers.get("content-type") ?? "";
        if (/pdf/i.test(type)) {
          const b = new Uint8Array(await page.arrayBuffer());
          text = await askAi(key, [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:application/pdf;base64,${toBase64(b)}` } }]);
        } else {
          const html = await page.text();
          const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 60000);
          // Dados estruturados (preço do anúncio) costumam vir em JSON-LD/meta.
          const meta = [...html.matchAll(/<meta[^>]+(?:property|name)="(?:og:title|og:description|product:price:amount|product:price:currency|twitter:data1)"[^>]*>/gi)].map((m) => m[0]).join("\n").slice(0, 4000);
          const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n").slice(0, 12000);
          text = await askAi(key, [{ type: "text", text: `${prompt}\n\nEsta cotação é uma página de produto/loja na internet (${q.file_path}). Fornecedor = a loja; prazo de pagamento = 0 se não houver; um item com o preço anunciado.\n\nMetadados:\n${meta}\n\nJSON-LD:\n${ld}\n\nTexto da página:\n${body}` }]);
        }
      } catch (e) { return fail((e as Error).message); }
      return await save(text);
    }
    const file = await sb.storage.from("purchase-photos").download(q.file_path);
    if (file.error || !file.data) return fail(`Arquivo indisponível: ${file.error?.message ?? ""}`);
    const bytes = new Uint8Array(await file.data.arrayBuffer());
    const name = (q.file_name ?? q.file_path).toLowerCase();
    try {
      if (/\.(xlsx|xlsm|xls|csv|ods)$/.test(name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(bytes, { type: "array" });
        const csv = wb.SheetNames.map((s) => `### ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s]!, { blankrows: false })}`).join("\n\n").slice(0, 60000);
        text = await askAi(key, [{ type: "text", text: `${prompt}\n\nConteúdo da planilha (CSV):\n${csv}` }]);
      } else if (/\.pdf$/.test(name)) {
        try {
          text = await askAi(key, [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:application/pdf;base64,${toBase64(bytes)}` } }]);
        } catch (e) {
          // Sem suporte a PDF direto: manda o texto do PDF.
          if (!(e as { status?: number }).status) throw e;
          const { pdfTexts } = await import("./fleet-invoices");
          const parts = (await pdfTexts(bytes)).join("\n").slice(0, 60000);
          if (!parts.trim()) throw new Error("PDF sem texto (digitalizado): envie como foto");
          text = await askAi(key, [{ type: "text", text: `${prompt}\n\nTexto do PDF:\n${parts}` }]);
        }
      } else {
        const mime = /\.png$/.test(name) ? "image/png" : /\.webp$/.test(name) ? "image/webp" : "image/jpeg";
        text = await askAi(key, [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(bytes)}` } }]);
      }
    } catch (e) {
      return fail((e as Error).message);
    }
    return await save(text);

    async function save(text: string) {
    let r;
    try { r = parseQuoteReading(text); } catch (e) { return fail((e as Error).message); }
    if (!q) throw new Error("Cotação não encontrada");
    const byNo = new Map(scItems.map((i) => [i.item_no, i]));
    const rows = r.items.map((it, k) => {
      const sc = (it.sc_item != null ? byNo.get(it.sc_item) : undefined) ?? scItems.find((x) => x.id === bestScItem(it.description, scItems));
      const conv = sc ? suggestConversion(Number(sc.quantity), sc.unit, it.quantity, it.unit) : { factor: 1, type: "M" as const };
      return {
        quote_id: q.id, line_no: k + 1, description: it.description.slice(0, 500), quantity: it.quantity, unit: it.unit, unit_price: it.unit_price, total: it.total,
        request_item_id: sc?.id ?? null, conv_factor: conv.factor, conv_type: conv.type,
      };
    });
    const del = await sb.from("purchase_quote_items").delete().eq("quote_id", q.id);
    if (del.error) return fail(del.error.message);
    if (rows.length) {
      const ins = await sb.from("purchase_quote_items").insert(rows);
      if (ins.error) return fail(ins.error.message);
    }
    const up = await sb.from("purchase_quotes").update({
      supplier: r.supplier, supplier_doc: r.supplier_doc, quote_number: r.quote_number, quote_date: r.quote_date, payment_terms: r.payment_terms,
      payment_days: r.payment_days, delivery_days: r.delivery_days, freight: r.freight, total: r.total,
      read_status: rows.length ? "lido" : "erro", read_error: rows.length ? null : "Nenhum item encontrado na cotação", matched: false,
    }).eq("id", q.id);
    if (up.error) throw up.error;
    return { ok: rows.length > 0, error: rows.length ? null : "Nenhum item encontrado na cotação", items: rows.length, supplier: r.supplier };
    }
  });

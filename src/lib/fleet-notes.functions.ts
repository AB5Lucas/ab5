import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function credentials() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
  if (!lovableKey || !excelKey) throw new Error("Conexão do Excel indisponível");
  return { lovableKey, excelKey };
}

/** Lê agora as pastas de XML e de notas do mês (botão "Ler pastas" em Frota › Notas). */
export const syncFleetNotesNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { month: string }) => {
    if (!/^\d{4}-\d{2}$/.test(d?.month ?? "")) throw new Error("Mês inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("can_access_page", { _path: "/frota/notas" });
    if (error || !allowed) throw new Error("Você não tem acesso a Frota › Notas");
    const { executeFleetNotesSync } = await import("./fleet-notes.server");
    return executeFleetNotesSync(data.month, credentials());
  });

/** Abre a nota (arquivo da pasta de notas) no SharePoint. */
export const fleetNoteLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { itemId: string }) => {
    if (!d?.itemId || typeof d.itemId !== "string") throw new Error("Arquivo inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: allowed, error } = await context.supabase.rpc("can_access_page", { _path: "/frota/notas" });
    if (error || !allowed) throw new Error("Você não tem acesso a Frota › Notas");
    const { noteFileUrl } = await import("./fleet-notes.server");
    return noteFileUrl(data.itemId, credentials());
  });

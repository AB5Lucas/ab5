import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
export const Route = createFileRoute("/api/public/jobs/billing-sync")({
  server: { handlers: { POST: async ({ request }) => {
    const failure = await authenticateCronRequest(request);
    if (failure) return failure;
    const body = await request.json().catch(() => null);
    if (!body || !["daily", "industry", "mars"].includes(body.kind)) return Response.json({ error: "Invalid request" }, { status: 400 });
    if (body.kind === "mars") {
      // Reprocessa meses da MARS (cron-secret); overwriteSuffix troca o sufixo do CC pelo da planilha (coluna C).
      const months = Array.isArray(body.months) ? body.months.filter((m: unknown) => typeof m === "string" && /^\d{4}-\d{2}$/.test(m)) : [];
      const lk = process.env["LOVABLE_API_KEY"]; const ek = process.env["MICROSOFT_EXCEL_API_KEY"];
      if (!months.length || !lk || !ek) return Response.json({ error: "Invalid request" }, { status: 400 });
      const { executeMarsSync } = await import("@/lib/mars-sync.server");
      const out = [];
      for (const m of months) out.push({ month: m, ...(await executeMarsSync({ lovableKey: lk, excelKey: ek }, "manual", m, { overwriteSuffix: body.overwriteSuffix === true })) });
      return Response.json(out);
    }
    if (body.kind === "industry") {
      // Reprocess specific Indústria months (cron-secret protected).
      const months = Array.isArray(body.months) ? body.months.filter((m: unknown) => typeof m === "string" && /^\d{4}-\d{2}$/.test(m)) : [];
      const lk = process.env["LOVABLE_API_KEY"]; const ek = process.env["MICROSOFT_EXCEL_API_KEY"];
      if (!months.length || !lk || !ek) return Response.json({ error: "Invalid request" }, { status: 400 });
      const { executeIndustrySync } = await import("@/lib/industry-sync.server");
      return Response.json(await executeIndustrySync({ lovableKey: lk, excelKey: ek }, "manual", months));
    }
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
    if (!lovableKey || !excelKey) return Response.json({ error: "Excel connection missing" }, { status: 503 });
    // Feriados nacionais e de Mogi Guaçu do ano atual e do seguinte (holidays_sync_year não recria os removidos/trocados).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const year = new Date().getFullYear();
    await Promise.all([year, year + 1].map((y) => supabaseAdmin.rpc("holidays_sync_year", { y }))).catch((e) => console.error("Holiday sync failed", e));
    const { executeBillingSync } = await import("@/lib/billing-sync.server");
    const { deferBilling } = await import("@/lib/billing-background.server");
    const { executeIndustrySync } = await import("@/lib/industry-sync.server");
    // MARS primeiro: os serviços que a planilha da MARS cria já recebem o faturamento na mesma execução.
    const { executeMarsSync } = await import("@/lib/mars-sync.server");
    const mars = executeMarsSync({ lovableKey, excelKey }, "daily").catch(error => console.error("MARS sync failed", error));
    const services = mars.then(() => executeBillingSync({ lovableKey, excelKey }, "daily"));
    const industry = executeIndustrySync({ lovableKey, excelKey }, "daily").catch(error => console.error("Industry sync failed", error));
    const { executeFleetSync } = await import("@/lib/fleet-costs.server");
    const fleet = executeFleetSync({ lovableKey, excelKey }).catch(error => console.error("Fleet costs sync failed", error));
    const work = services.finally(() => Promise.all([industry, fleet, mars]));
    const background = Promise.allSettled([services, industry, fleet, mars]).then(r => { if (r[0].status === "rejected") console.error("Billing sync failed", r[0].reason); });
    // Nitro's Cloudflare adapter attaches the execution context to the request.
    if ("waitUntil" in request && typeof request.waitUntil === "function") {
      request.waitUntil(background);
      return Response.json({ status: "accepted" }, { status: 202 });
    }
    if (deferBilling(background)) return Response.json({ status: "accepted" }, { status: 202 });
    try { return Response.json(await work); } catch { return Response.json({ error: "Synchronization failed; see run history" }, { status: 503 }); }
  } } },
});
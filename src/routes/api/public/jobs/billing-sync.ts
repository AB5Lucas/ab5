import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
export const Route = createFileRoute("/api/public/jobs/billing-sync")({
  server: { handlers: { POST: async ({ request }) => {
    const failure = await authenticateCronRequest(request);
    if (failure) return failure;
    const body = await request.json().catch(() => null);
    if (!body || !["daily", "industry"].includes(body.kind)) return Response.json({ error: "Invalid request" }, { status: 400 });
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
    const { executeBillingSync } = await import("@/lib/billing-sync.server");
    const { deferBilling } = await import("@/lib/billing-background.server");
    const { executeIndustrySync } = await import("@/lib/industry-sync.server");
    const services = executeBillingSync({ lovableKey, excelKey }, "daily");
    const industry = executeIndustrySync({ lovableKey, excelKey }, "daily").catch(error => console.error("Industry sync failed", error));
    const work = services.finally(() => industry);
    const background = Promise.allSettled([services, industry]).then(r => { if (r[0].status === "rejected") console.error("Billing sync failed", r[0].reason); });
    // Nitro's Cloudflare adapter attaches the execution context to the request.
    if ("waitUntil" in request && typeof request.waitUntil === "function") {
      request.waitUntil(background);
      return Response.json({ status: "accepted" }, { status: 202 });
    }
    if (deferBilling(background)) return Response.json({ status: "accepted" }, { status: 202 });
    try { return Response.json(await work); } catch { return Response.json({ error: "Synchronization failed; see run history" }, { status: 503 }); }
  } } },
});
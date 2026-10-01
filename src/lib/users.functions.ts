import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Exclui a conta de um usuário (somente administradores) para que ele possa se cadastrar de novo. */
export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ userId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error } = await context.supabase.rpc("is_admin");
    if (error || !isAdmin) throw new Error("Somente administradores podem excluir usuários.");
    if (data.userId === context.userId) throw new Error("Você não pode excluir a sua própria conta.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const u = data.userId;
    await Promise.all([
      supabaseAdmin.from("audit_logs").update({ user_id: null }).eq("user_id", u),
      supabaseAdmin.from("daily_schedules").update({ created_by: null }).eq("created_by", u),
      supabaseAdmin.from("daily_schedules").update({ updated_by: null }).eq("updated_by", u),
      supabaseAdmin.from("daily_allocations").update({ confirmed_by: null }).eq("confirmed_by", u),
      supabaseAdmin.from("conference_items").update({ completed_by: null }).eq("completed_by", u),
    ]);
    await supabaseAdmin.from("foreman_works").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("rdo_user_prefs").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("vehicle_view_prefs").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("users_profiles").delete().eq("id", data.userId);
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });

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
    await supabaseAdmin.from("foreman_works").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("rdo_user_prefs").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("vehicle_view_prefs").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    await supabaseAdmin.from("users_profiles").delete().eq("id", data.userId);
    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });

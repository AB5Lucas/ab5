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

/** Admin define uma senha provisória; no próximo acesso o usuário é obrigado a criar uma nova. */
export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ userId: z.string().uuid(), tempPassword: z.string().min(6).max(72) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error } = await context.supabase.rpc("is_admin");
    if (error || !isAdmin) throw new Error("Somente administradores podem resetar senhas.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u, error: gErr } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (gErr || !u.user) throw new Error("Usuário não encontrado.");
    const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: data.tempPassword,
      app_metadata: { ...(u.user.app_metadata ?? {}), must_change_password: true },
    });
    if (upErr) throw new Error(upErr.message);
    return { ok: true };
  });

/** Remove a obrigação de troca de senha do próprio usuário (após definir a nova senha). */
export const clearMustChangePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const meta = { ...(u.user?.app_metadata ?? {}) } as Record<string, unknown>;
    delete meta.must_change_password;
    await supabaseAdmin.auth.admin.updateUserById(context.userId, { app_metadata: meta });
    return { ok: true };
  });

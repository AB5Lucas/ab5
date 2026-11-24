import { useEffect } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-auth";
import type { Tables } from "@/integrations/supabase/types";

export type AppNotification = Tables<"notifications">;
export const NOTIF_KEY = ["notifications"] as const;

/** Recentes + contador de não lidas (sino). Atualiza ao vivo pelo Realtime e, de reserva, a cada 2 min. */
export function useRecentNotifications(limit = 20) {
  const { user } = useSession();
  const uid = user?.id;
  return useQuery({
    queryKey: [...NOTIF_KEY, "recent", uid, limit],
    enabled: !!uid,
    refetchInterval: 120_000,
    queryFn: async () => {
      const [list, unread] = await Promise.all([
        supabase.from("notifications").select("*").eq("user_id", uid!).order("created_at", { ascending: false }).limit(limit),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid!).is("read_at", null),
      ]);
      if (list.error) throw list.error;
      return { items: list.data ?? [], unread: unread.count ?? 0 };
    },
  });
}

/** Histórico paginado (página de Notificações). */
export function useNotificationPage(page: number, pageSize: number, onlyUnread: boolean) {
  const { user } = useSession();
  const uid = user?.id;
  return useQuery({
    queryKey: [...NOTIF_KEY, "page", uid, page, pageSize, onlyUnread],
    enabled: !!uid,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from("notifications").select("*", { count: "exact" }).eq("user_id", uid!);
      if (onlyUnread) q = q.is("read_at", null);
      const { data, count, error } = await q.order("created_at", { ascending: false }).order("id").range(page * pageSize, page * pageSize + pageSize - 1);
      if (error) throw error;
      return { items: data ?? [], total: count ?? 0 };
    },
  });
}

/** Realtime: uma assinatura por sessão (fica no sino, que está sempre montado). */
export function useNotificationsRealtime() {
  const { user } = useSession();
  const qc = useQueryClient();
  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`notifications:${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, (payload) => {
        qc.invalidateQueries({ queryKey: NOTIF_KEY });
        if (payload.eventType === "INSERT") {
          const n = payload.new as AppNotification;
          toast(n.title, { description: [n.ref, n.body].filter(Boolean).join(" · ") || undefined });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, qc]);
}

export function useMarkRead() {
  const { user } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | "all") => {
      let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user!.id).is("read_at", null);
      if (ids !== "all") q = q.in("id", ids);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIF_KEY }),
  });
}

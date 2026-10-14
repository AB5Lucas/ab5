import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { depreciation } from "@/lib/andaimes";

export const Route = createFileRoute("/_authenticated/andaimes/patrimonio")({
  head: () => ({
    meta: [
      { title: "Patrimônio de Andaimes | AB5 Hub" },
      { name: "description", content: "Valores patrimoniais, depreciação e perdas do estoque de andaimes." },
      { property: "og:title", content: "Patrimônio de Andaimes | AB5 Hub" },
      { property: "og:description", content: "Valor do ativo de andaimes e perdas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const LOSS = ["danificado", "manutencao"];

function Page() {
  const { isAdmin } = useCurrentUser();
  const qc = useQueryClient();
  const items = useQuery({ queryKey: ["andam-items-all"], queryFn: async () => (await supabase.from("andam_items").select("id, name, unit").order("name")).data ?? [] });
  const stock = useQuery({ queryKey: ["andam-stock-all"], queryFn: async () => (await supabase.from("andam_stock").select("item_id, location, quantity")).data ?? [] });
  const vals = useQuery({ queryKey: ["andam-asset"], enabled: isAdmin, queryFn: async () => (await supabase.from("andam_asset_values").select("*")).data ?? [] });
  const [edit, setEdit] = useState<Record<string, any>>({});
  if (!isAdmin) return <div className="p-6 text-muted-foreground">Página restrita a administradores.</div>;
  const vMap = new Map((vals.data ?? []).map((v: any) => [v.item_id, v]));
  const qtyOf = (id: string, locs?: string[]) => (stock.data ?? []).filter((s: any) => s.item_id === id && (!locs || locs.includes(s.location))).reduce((a: number, s: any) => a + Number(s.quantity), 0);
  const save = async (item_id: string, k: string, raw: string) => {
    const cur: any = vMap.get(item_id) ?? {};
    const v = k === "acquired_at" ? raw || null : Number(raw || 0);
    const { error } = await supabase.from("andam_asset_values").upsert({ ...cur, item_id, [k]: v, updated_at: undefined });
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["andam-asset"] });
  };
  const today = new Date().toISOString().slice(0, 10);
  const rows = (items.data ?? []).map((i: any) => {
    const v: any = vMap.get(i.id) ?? {};
    const total = qtyOf(i.id), loss = qtyOf(i.id, LOSS);
    const acq = Number(v.acquisition_value ?? 0);
    const dep = depreciation(acq, Number(v.useful_life_months ?? 60), v.acquired_at, today);
    return { i, v, total, loss, gross: total * acq, dep: total * dep, net: total * (acq - dep), lossValue: loss * Number(v.replacement_value ?? 0), rent: total * Number(v.rental_value_month ?? 0) };
  });
  const sum = (k: "gross" | "dep" | "net" | "lossValue" | "rent") => rows.reduce((a, r) => a + r[k], 0);
  const cell = (id: string, k: string, v: any, type = "number") => (
    <Input type={type} className="h-8 w-28" defaultValue={v ?? ""} key={`${id}-${k}-${v}`}
      onChange={(e) => setEdit({ ...edit, [id + k]: e.target.value })}
      onBlur={(e) => e.target.value !== String(v ?? "") && save(id, k, e.target.value)} />
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Patrimônio" description="Valores dos materiais de andaime. Visível apenas para administradores." />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {([["Valor de aquisição", sum("gross")], ["Depreciação acumulada", sum("dep")], ["Valor líquido", sum("net")], ["Perdas (danif./manut.)", sum("lossValue")], ["Locação potencial/mês", sum("rent")]] as const).map(([l, n]) => (
          <div key={l} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-lg font-semibold">{brl(n)}</div></div>
        ))}
      </div>
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Material</TableHead><TableHead>Qtd. total</TableHead><TableHead>Valor aquisição (un)</TableHead><TableHead>Reposição (un)</TableHead>
            <TableHead>Locação/mês (un)</TableHead><TableHead>Vida útil (meses)</TableHead><TableHead>Aquisição</TableHead>
            <TableHead>Valor líquido</TableHead><TableHead>Perdas</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(({ i, v, total, loss, net, lossValue }) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell>{total} {i.unit}</TableCell>
                <TableCell>{cell(i.id, "acquisition_value", v.acquisition_value)}</TableCell>
                <TableCell>{cell(i.id, "replacement_value", v.replacement_value)}</TableCell>
                <TableCell>{cell(i.id, "rental_value_month", v.rental_value_month)}</TableCell>
                <TableCell>{cell(i.id, "useful_life_months", v.useful_life_months ?? 60)}</TableCell>
                <TableCell>{cell(i.id, "acquired_at", v.acquired_at, "date")}</TableCell>
                <TableCell>{brl(net)}</TableCell>
                <TableCell className={loss ? "text-destructive" : ""}>{brl(lossValue)}{loss ? ` (${loss})` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter><TableRow><TableCell colSpan={7}>Total</TableCell><TableCell>{brl(sum("net"))}</TableCell><TableCell>{brl(sum("lossValue"))}</TableCell></TableRow></TableFooter>
        </Table>
      </div>
    </div>
  );
}

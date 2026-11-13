import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { invoiceFortnight, invoiceNumber } from "@/lib/fleet-invoices";
import { ccTotals, fortnightRange } from "@/lib/fleet-fiscal";
import { useFuelRows } from "./use-fuel-rows";

const brl = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const pct = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * Frota › Abastecimento › Fiscal: escolhe uma fatura do posto e mostra os centros de custo da quinzena cobrada,
 * com o mesmo rateio da aba Abastecimentos (o total bate com o Total do período filtrando a quinzena). CC TICKET fica fora.
 */
export function FleetFiscalCc() {
  const invoices = useQuery({ queryKey: ["fleet-invoices"], queryFn: async () => (await supabase.from("fleet_invoices").select("*").order("issued_on")).data ?? [] });
  const list = useMemo(() => (invoices.data ?? []).map((i) => ({ ...i, numberShown: i.number ? invoiceNumber(i.number) : i.file_name, ...invoiceFortnight(i.period_from, i.issued_on) }))
    .filter((i) => i.month && i.year && i.fortnight).reverse(), [invoices.data]);
  const [id, setId] = useState<string>("");
  useEffect(() => { if (!id && list.length) setId(list[0]!.id); }, [list, id]);
  const inv = list.find((i) => i.id === id);
  const range = inv ? fortnightRange(inv.year!, inv.month!, inv.fortnight!) : { from: "1900-01-01", to: "1900-01-01" };
  const { rows, loading } = useFuelRows(range);
  const t = useMemo(() => ccTotals(rows), [rows]);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4">
        <div className="panel space-y-3 p-4">
          <div className="space-y-1">
            <Label>Fatura</Label>
            <Select value={id} onValueChange={setId}>
              <SelectTrigger><SelectValue placeholder={invoices.isLoading ? "Carregando..." : "Escolha a fatura"} /></SelectTrigger>
              <SelectContent className="max-h-72">
                {list.map((i) => <SelectItem key={i.id} value={i.id}>{i.numberShown} · {i.fortnight}ª quinzena de {MONTHS[i.month! - 1]}/{i.year}</SelectItem>)}
              </SelectContent>
            </Select>
            {!invoices.isLoading && !list.length && <p className="text-xs text-muted-foreground">Nenhuma fatura lida. Use Ler pasta na subaba Fatura.</p>}
          </div>
          {inv && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2"><dt className="text-xs text-muted-foreground">Valor total da fatura</dt><dd className="text-lg font-semibold tabular-nums">{brl(inv.total)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Mês de cobrança</dt><dd className="font-medium capitalize">{MONTHS[inv.month! - 1]}/{inv.year}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Quinzena</dt><dd className="font-medium">{inv.fortnight}ª quinzena</dd></div>
              <div className="col-span-2 text-xs text-muted-foreground">Abastecimentos de {range.from.split("-").reverse().join("/")} a {range.to.split("-").reverse().join("/")}.</div>
            </dl>
          )}
        </div>
        {inv && (
          <div className="panel space-y-2 p-4">
            <div className="text-xs text-muted-foreground">Divisão da quinzena</div>
            <div className="flex items-baseline justify-between text-sm"><span>Serviços (CC 2…)</span><span className="font-semibold tabular-nums">{pct(t.share.servicos)}</span></div>
            <div className="flex items-baseline justify-between text-sm"><span>Indústria (CC 1…)</span><span className="font-semibold tabular-nums">{pct(t.share.industria)}</span></div>
            {t.share.outros > 0 && <div className="flex items-baseline justify-between text-sm text-muted-foreground"><span>Sem CC / outros</span><span className="tabular-nums">{pct(t.share.outros)}</span></div>}
          </div>
        )}
      </div>

      <div className="panel overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Centro de custo</TableHead>
              <TableHead>Item conta</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">% da quinzena</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!inv ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">Escolha uma fatura.</TableCell></TableRow>
              : loading ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">Carregando...</TableCell></TableRow>
              : !t.lines.length ? <TableRow><TableCell colSpan={4} className="text-muted-foreground">Nenhum abastecimento nesta quinzena.</TableCell></TableRow>
              : t.lines.map((l) => (
                <TableRow key={`${l.cc}|${l.item}`}>
                  <TableCell className="font-medium">{l.cc ?? <span className="text-muted-foreground">sem CC (sem programação)</span>}</TableCell>
                  <TableCell>{l.item ?? <span className="text-muted-foreground">sem equivalência</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(l.value)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(l.pct)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
          {inv && t.lines.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Total ({t.lines.length} centro(s) de custo)</TableCell>
                <TableCell className="text-right tabular-nums">{brl(t.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(100)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
        {inv && t.ticket > 0 && (
          <p className="border-t border-border p-3 text-xs text-muted-foreground">
            CC TICKET fora da tabela, do total e do Saldo: {brl(t.ticket)}.
          </p>
        )}
      </div>
    </div>
  );
}



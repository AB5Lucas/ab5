import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Gráficos da página Resultados, em arquivo próprio para o recharts ser carregado sob demanda (React.lazy). */
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** Andamento Mensal: custos (MO, materiais, transporte) por mês; mês sem custo mostra só o faturamento no tooltip. */
export function MonthBarsChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ left: 20 }}>
        <CartesianGrid vertical={false} className="stroke-border" />
        <XAxis dataKey="label" fontSize={11} />
        <YAxis fontSize={11} tickFormatter={(v: number) => brl(v)} width={100} />
        <Tooltip
          content={({ active, payload, label }: any) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload;
            const empty = !p.mo && !p.materiais && !p.transporte;
            if (empty && !p.faturamento) return null;
            return (
              <div className="rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow">
                <p className="mb-1 font-medium">{label}</p>
                {empty ? (
                  <p>Faturamento: {brl(p.faturamento)}</p>
                ) : (
                  payload.map((it: any) => (
                    <p key={it.dataKey} style={{ color: it.color }}>
                      {it.name}: {brl(Number(it.value ?? 0))}
                    </p>
                  ))
                )}
              </div>
            );
          }}
        />
        <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
        <Bar dataKey="mo" name="R$ Total MO" fill="var(--chart-blue)" />
        <Bar dataKey="materiais" name="R$ Total Materiais" fill="var(--muted-foreground)" />
        <Bar dataKey="transporte" name="R$ Total Transporte" fill="var(--foreground)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Custo realizado × orçado por item (barras horizontais, % usado no rótulo). */
export function ItemBarsChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ right: 48 }} barGap={2}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={80} fontSize={11} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v: number) => brl(v)} />
        <Legend wrapperStyle={{ fontSize: 13 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
        <Bar dataKey="real" name="Custo Realizado" fill="var(--chart-blue)">
          <LabelList dataKey="used" position="right" fontSize={11} className="fill-foreground" formatter={(v: number) => pct(Math.round(v))} />
        </Bar>
        <Bar dataKey="budget" name="Custo Orçado" fill="var(--chart-2)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Gráficos da Frota › Visão Geral, em arquivo próprio para o recharts ser carregado sob demanda (React.lazy). */
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = (v: number) => (Math.abs(v) >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl(v));

/** Orçado × real por veículo no mês (kmCost = referência km × taxa). */
export function VehicleBarsChart({ data, kmRate }: { data: any[]; kmRate: number }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ left: 8, right: 16, bottom: 8 }} barGap={2} barCategoryGap="20%">
        <CartesianGrid vertical={false} className="stroke-border" />
        <XAxis dataKey="plate" fontSize={10} interval={0} angle={-40} textAnchor="end" height={52} tickLine={false} />
        <YAxis fontSize={11} tickFormatter={(v: number) => brlShort(v)} width={80} />
        <Tooltip formatter={(v: number) => brl(v)} labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""} />
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
        <Bar dataKey="budget" name="Orçado" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="real" name="Real" fill="var(--chart-blue)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="kmCost" name={`Km × ${brl(kmRate)}`} fill="var(--muted-foreground)" fillOpacity={0.45} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Orçado × real nos últimos 12 meses. */
export function TrendLineChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ left: 8, right: 16 }}>
        <CartesianGrid vertical={false} className="stroke-border" />
        <XAxis dataKey="label" fontSize={11} />
        <YAxis fontSize={11} tickFormatter={(v: number) => brlShort(v)} width={80} />
        <Tooltip formatter={(v: number) => brl(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
        <Line type="monotone" dataKey="Orçado" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 4 }} />
        <Line type="monotone" dataKey="Real" stroke="var(--chart-blue)" strokeWidth={2} dot={{ r: 4 }} />
        <Line type="monotone" dataKey="Km × 1,35" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

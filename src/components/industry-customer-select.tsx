import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Clientes Indústria (logística do caminhão): lista própria, separada dos clientes de Serviços. */
export type IndustryCustomer = { id: string; name: string; km_one_way: number | null; has_toll: boolean; toll_amount: number | null };

const ADD = "__add__";
const LEGACY = "__legacy__";
const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

export function useIndustryCustomers() {
  return useQuery({
    queryKey: ["industry-customers"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("industry_customers").select("id, name, km_one_way, has_toll, toll_amount").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as IndustryCustomer[];
    },
  });
}

export function findIndustryCustomer(list: IndustryCustomer[] | undefined, name: string | null | undefined) {
  const n = norm(name);
  return n ? (list ?? []).find((c) => norm(c.name) === n) : undefined;
}

/** Km de ida do local cadastrado; null = sem km preenchido (a Transporte usa os 100 km de antes). */
export function industryKmOneWay(list: IndustryCustomer[] | undefined, name: string | null | undefined) {
  const km = findIndustryCustomer(list, name)?.km_one_way;
  return km != null && Number(km) > 0 ? Number(km) : null;
}

/** Pedágio de ida do local (null = local sem cadastro; 0 = cadastrado sem pedágio). */
export function industryToll(list: IndustryCustomer[] | undefined, name: string | null | undefined) {
  const c = findIndustryCustomer(list, name);
  return c ? (c.has_toll ? Number(c.toll_amount ?? 0) : 0) : null;
}

/**
 * Lista suspensa de clientes Indústria para o local do caminhão. O primeiro item abre o cadastro (nome + km de ida).
 * Locais antigos digitados à mão continuam aparecendo enquanto não forem trocados.
 */
export function IndustryCustomerSelect({ value, onChange, ariaLabel, disabled }: { value: string; onChange: (name: string) => void; ariaLabel?: string; disabled?: boolean }) {
  const customers = useIndustryCustomers();
  const [adding, setAdding] = useState(false);
  const match = findIndustryCustomer(customers.data, value);
  const selected = match ? match.id : value.trim() ? LEGACY : "";
  return (
    <>
      <Select
        value={selected}
        disabled={!!disabled}
        onValueChange={(v) => {
          if (v === ADD) { setAdding(true); return; }
          if (v === LEGACY) return;
          const c = (customers.data ?? []).find((x) => x.id === v);
          if (c) onChange(c.name);
        }}
      >
        <SelectTrigger aria-label={ariaLabel ?? "Local"}><SelectValue placeholder="Selecione o cliente Indústria" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ADD} className="font-medium text-primary">
            <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Adicionar cliente</span>
          </SelectItem>
          <SelectSeparator />
          {selected === LEGACY && <SelectItem value={LEGACY}>{value.toUpperCase()} (digitado antes)</SelectItem>}
          {(customers.data ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name.toUpperCase()}
              <span className="ml-2 text-xs text-muted-foreground">{c.km_one_way != null && Number(c.km_one_way) > 0 ? `${Number(c.km_one_way)} km ida` : "sem km (100)"}{c.has_toll ? ` · pedágio R$ ${Number(c.toll_amount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <AddIndustryCustomer open={adding} onOpenChange={setAdding} onCreated={(c) => onChange(c.name)} />
    </>
  );
}

function AddIndustryCustomer({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: IndustryCustomer) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [km, setKm] = useState("");
  const [hasToll, setHasToll] = useState(false);
  const [toll, setToll] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const n = name.trim().replace(/\s+/g, " ");
      if (!n) throw new Error("Informe o nome do cliente.");
      const k = km.trim() === "" ? null : Number(km.replace(",", "."));
      if (k != null && (!Number.isFinite(k) || k < 0)) throw new Error("Km de ida inválido.");
      const t = hasToll ? Number(toll.replace(",", ".")) : null;
      if (hasToll && (!Number.isFinite(t) || (t ?? 0) <= 0)) throw new Error("Informe o valor do pedágio.");
      const { data, error } = await supabase.from("industry_customers").insert({ name: n.toUpperCase(), km_one_way: k, has_toll: hasToll, toll_amount: t })
        .select("id, name, km_one_way, has_toll, toll_amount").single();
      if (error) throw new Error(error.code === "23505" ? "Esse cliente já está cadastrado." : error.message);
      return data as IndustryCustomer;
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["industry-customers"] });
      toast.success(`Cliente ${c.name} cadastrado`);
      onCreated(c);
      setName(""); setKm(""); setHasToll(false); setToll("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adicionar cliente Indústria</DialogTitle>
          <DialogDescription>Lista própria do caminhão, separada dos clientes de Serviços. O km de ida e o pedágio contam × 2 (ida e volta); sem km, vale 100 km.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ind-name">Nome do cliente</Label>
            <Input id="ind-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Palini" autoFocus />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ind-km">Km de ida</Label>
            <Input id="ind-km" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="Ex.: 45" />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="ind-toll" checked={hasToll} onCheckedChange={setHasToll} />
            <Label htmlFor="ind-toll">Tem pedágio</Label>
          </div>
          {hasToll && (
            <div className="space-y-1">
              <Label htmlFor="ind-toll-value">Valor do pedágio (ida)</Label>
              <Input id="ind-toll-value" inputMode="decimal" value={toll} onChange={(e) => setToll(e.target.value)} placeholder="Ex.: 12,50" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

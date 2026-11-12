import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export type PlateOption = { plate: string; name: string | null };
const ALL = "all";
const text = (o: PlateOption) => (o.name && o.name !== o.plate ? `${o.plate} - ${o.name}` : o.plate);

/** Filtro de placa com busca: digite parte da placa ou do nome do veículo. Lista "PLACA - veículo". */
export function PlateFilter({ value, onChange, options, label = "Placa", id = "plate-filter" }: {
  value: string; onChange: (v: string) => void; options: PlateOption[]; label?: string; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.plate === value);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="block">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} variant="outline" role="combobox" aria-expanded={open} className="flex w-64 justify-between font-normal">
            <span className="truncate">{value === ALL || !current ? "Todas" : text(current)}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="TDJ9B39 ou Onix" />
            <CommandList>
              <CommandEmpty>Nenhuma placa encontrada.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="Todas as placas" onSelect={() => pick(ALL)}>
                  <Check className={`h-4 w-4 ${value === ALL ? "opacity-100" : "opacity-0"}`} /> Todas
                </CommandItem>
                {options.map((o) => (
                  <CommandItem key={o.plate} value={`${o.plate} ${o.name ?? ""}`} onSelect={() => pick(o.plate)}>
                    <Check className={`h-4 w-4 ${value === o.plate ? "opacity-100" : "opacity-0"}`} /> {text(o)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

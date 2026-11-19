import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; hint?: string | undefined };

/** Select em que se digita para achar a opção (busca pelo texto e pela dica, ex.: nº do pedido, CC). */
export function SearchSelect({ value, onChange, options, placeholder = "Selecione", searchPlaceholder = "Digite para buscar", className, disabled, id }: {
  value: string; onChange: (v: string) => void; options: SearchOption[]; placeholder?: string; searchPlaceholder?: string;
  className?: string; disabled?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled}
          className={cn("w-full justify-between px-3 font-normal", className)}>
          <span className={cn("truncate", !cur && "text-muted-foreground")}>{cur ? cur.label : placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""} ${o.value}`} onSelect={() => { onChange(o.value); setOpen(false); }}>
                  <Check className={cn("h-3.5 w-3.5", o.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Igual ao SearchSelect, mas marca várias opções; nada marcado = todos (allLabel). */
export function MultiSearchSelect({ values, onChange, options, allLabel = "Todos", searchPlaceholder = "Digite para buscar", className, id }: {
  values: string[]; onChange: (v: string[]) => void; options: SearchOption[]; allLabel?: string; searchPlaceholder?: string; className?: string; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const picked = options.filter((o) => values.includes(o.value));
  const label = !picked.length ? allLabel : picked.length === 1 ? picked[0]!.label : `${picked.length} selecionados`;
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open}
          className={cn("w-full justify-between px-3 font-normal", className)} title={picked.map((o) => o.label).join(", ")}>
          <span className={cn("truncate", !picked.length && "text-muted-foreground")}>{label}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nada encontrado.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`__all__ ${allLabel}`} onSelect={() => onChange([])}>
                <Check className={cn("mr-2 h-4 w-4", picked.length ? "opacity-0" : "opacity-100")} /> {allLabel}
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""} ${o.value}`} onSelect={() => toggle(o.value)}>
                  <Check className={cn("mr-2 h-4 w-4", values.includes(o.value) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

import { toast } from "sonner";

/** Copia "Título\n\nnome\nnome" (nomes únicos, na ordem) para a área de transferência. */
export async function copyNameList(title: string, names: (string | null | undefined)[]) {
  const list = Array.from(new Set(names.filter((n): n is string => !!n && n.trim() !== "")));
  if (list.length === 0) {
    toast.error("Nenhum nome para copiar.");
    return;
  }
  try {
    await navigator.clipboard.writeText(`${title}\n\n${list.join("\n")}`);
    toast.success(`${list.length} nome(s) copiado(s).`);
  } catch {
    toast.error("Não foi possível copiar.");
  }
}

export function formatCpf(cpf: string | null | undefined) {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf ?? "—";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Imagem da fachada dos clientes (página Clientes em quadros). Todas geradas pela IA no MESMO estilo, a partir do nome e do
 * endereço cadastrados, para o quadro ficar padronizado (foto real exigiria chave do Google Street View e viria com estilos
 * e ângulos diferentes).
 */
export type ClientForImage = { name: string; address?: string | null; number?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null; notes?: string | null };

/** Clientes internos da AB5 (mesmo endereço da sede): a imagem é a da própria AB5. */
const INTERNAL = new Set(["ADM", "COMERCIAL", "PATIO", "PÁTIO", "INDUSTRIA", "INDÚSTRIA"]);

export function clientImagePrompt(c: ClientForImage): string {
  const addr = [c.address, c.number, c.neighborhood, c.city && `${c.city}${c.state ? `-${c.state}` : ""}`].filter(Boolean).join(", ");
  const who = INTERNAL.has(c.name.trim().toUpperCase())
    ? "a sede da AB5 Indústria e Comércio (empresa de manutenção industrial, andaimes e caldeiraria)"
    : `a unidade da empresa "${c.name.trim()}"${c.notes?.trim() ? ` (${c.notes.trim()})` : ""}`;
  return [
    `Fotografia arquitetônica realista da fachada de ${who}, localizada em ${addr || "cidade do interior de São Paulo"}, Brasil.`,
    "Estilo único e padronizado para um catálogo corporativo: vista frontal a partir da rua, câmera na altura dos olhos,",
    "enquadramento horizontal 16:9, dia claro com céu levemente nublado, luz suave, cores neutras e naturais,",
    "portaria/entrada principal em primeiro plano, prédio industrial ou comercial típico da região, gramado e calçada limpos.",
    "Sem pessoas, sem carros em primeiro plano, sem marcas d'água, sem texto além de uma placa discreta com o nome da empresa.",
  ].join(" ");
}

/** Caminho no bucket público client-images. */
export const clientImagePath = (clientId: string) => `${clientId}/${Date.now()}.png`;

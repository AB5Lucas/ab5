/**
 * Imagem dos clientes (página Clientes em quadros) a partir de imagem REAL, nunca inventada:
 * 1) foto de referência do cadastro (clients.image_source: colada no cadastro ou link);
 * 2) fotos do lugar no Google Maps (Places API; GOOGLE_MAPS_API_KEY), procurado pelo nome + endereço;
 * 3) busca de imagens do Google (GOOGLE_CSE_KEY e GOOGLE_CSE_CX).
 * Sem foto real, não gera nada. A IA só limpa a imagem real (tira textos, anúncios e marcas; não inventa prédios), em 16:9.
 */
export type ClientForImage = { name: string; address?: string | null; number?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null; notes?: string | null };
export type ImageOrigin = "foto" | "maps" | "busca";

export const ORIGIN_LABEL: Record<ImageOrigin, string> = { foto: "Foto de referência", maps: "Foto do Google Maps", busca: "Foto da internet" };

export function photoCleanupPrompt(c: ClientForImage): string {
  return [
    `Esta é uma foto real da empresa "${c.name.trim()}"${c.city ? ` em ${c.city}` : ""}.`,
    "Edite a foto: remova todos os textos, faixas, quadros de propaganda, ícones, logotipos e marcas d'água colocados POR CIMA da imagem,",
    "reconstruindo o fundo de forma natural (céu, prédio, vegetação, rua).",
    "Mantenha o prédio e o ambiente exatamente como são: mesmas cores, formas, proporções e posição; não invente nem remova construções.",
    "O letreiro que faz parte da fachada física do prédio pode permanecer.",
    "Entregue em formato horizontal 16:9 (recorte ou estenda o céu/chão com naturalidade), com aparência de fotografia profissional, nítida e bem iluminada.",
  ].join(" ");
}

/** Consultas para localizar o cliente no mapa (OpenStreetMap), da mais precisa para a menos. */
export function geocodeQueries(c: ClientForImage): string[] {
  const city = [c.city, c.state].filter(Boolean).join(", ");
  const num = c.number && !/^km/i.test(c.number.trim()) ? ` ${c.number}` : "";
  const out = [c.address && `${c.address}${num}, ${city}, Brasil`, c.address && `${c.address}, ${city}, Brasil`, city && `${city}, Brasil`].filter(Boolean) as string[];
  return [...new Set(out)];
}

export const clientImagePath = (clientId: string) => `${clientId}/${Date.now()}.png`;

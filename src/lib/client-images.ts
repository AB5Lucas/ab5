/**
 * Imagem dos clientes (página Clientes em quadros) a partir de imagem REAL, nunca inventada:
 * 1) foto de referência do cadastro (clients.image_source: colada no cadastro ou link);
 * 2) busca de imagens do Google (se GOOGLE_CSE_KEY e GOOGLE_CSE_CX estiverem configurados);
 * 3) vista aérea do satélite (Esri World Imagery) no endereço localizado pelo OpenStreetMap (Nominatim).
 * A IA só limpa/realça a imagem real (tira textos, anúncios e marcas; não inventa prédios), no formato 16:9.
 */
export type ClientForImage = { name: string; address?: string | null; number?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null; notes?: string | null };
export type ImageOrigin = "foto" | "busca" | "aerea";

export const ORIGIN_LABEL: Record<ImageOrigin, string> = { foto: "Foto de referência", busca: "Foto da internet", aerea: "Vista aérea (satélite Esri)" };

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

export function aerialPrompt(c: ClientForImage): string {
  return [
    `Esta é uma imagem de satélite (vista de cima) do local da empresa "${c.name.trim()}".`,
    "Melhore nitidez, contraste e cores para parecer uma fotografia aérea profissional feita por drone em dia claro,",
    "mantendo EXATAMENTE os mesmos prédios, telhados, pátios, ruas, árvores e posições. Não acrescente nem remova nada.",
    "Sem textos, rótulos, marcas d'água ou bordas. Formato horizontal 16:9.",
  ].join(" ");
}

/** Consultas de localização, da mais precisa para a menos (o nome da empresa costuma estar no mapa). */
export function geocodeQueries(c: ClientForImage): string[] {
  const city = [c.city, c.state].filter(Boolean).join(", ");
  const street = [c.address, c.number].filter(Boolean).join(" ");
  const out = [`${c.name} ${city}`, street && `${street}, ${city}, Brasil`, c.address && `${c.address}, ${city}, Brasil`].filter(Boolean) as string[];
  return [...new Set(out)];
}

/** Recorte 16:9 (~500 m de largura) em graus em volta do ponto, para a exportação do satélite. */
export function aerialBbox(lat: number, lon: number, widthMeters = 520) {
  const h = (widthMeters * 9) / 16;
  const dLat = h / 2 / 111_320;
  const dLon = widthMeters / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat] as const;
}

export const clientImagePath = (clientId: string) => `${clientId}/${Date.now()}.png`;

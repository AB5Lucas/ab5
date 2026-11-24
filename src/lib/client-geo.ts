/** Ponto do cliente no mapa pelo endereço (OpenStreetMap/Nominatim, no navegador; 1 consulta por segundo). */
import { geocodeQueries, type ClientForImage } from "./client-images";

export async function geocodeClient(c: ClientForImage): Promise<{ lat: number; lon: number } | null> {
  for (const q of geocodeQueries(c)) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "pt-BR" } });
      const hit = ((await r.json()) as any[])[0];
      if (hit) return { lat: Number(hit.lat), lon: Number(hit.lon) };
    } catch { /* próxima */ }
    await new Promise((res) => setTimeout(res, 1100));
  }
  return null;
}

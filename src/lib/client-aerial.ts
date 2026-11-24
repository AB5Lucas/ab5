/**
 * Vista aérea real do cliente montada no navegador: endereço → ponto (OpenStreetMap/Nominatim) → blocos do satélite
 * Esri World Imagery (zoom 18) colados num quadro 16:9 (~420 × 240 m). A exportação direta do satélite não funciona,
 * por isso os blocos são juntados aqui.
 */
import { geocodeQueries, type ClientForImage } from "./client-images";

const TILE = 256, Z = 18, W = 768, H = 432;
const tileUrl = (x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`;

export async function geocode(c: ClientForImage): Promise<{ lat: number; lon: number; label: string } | null> {
  for (const q of geocodeQueries(c).slice(1).concat(geocodeQueries(c).slice(0, 1))) { // endereço antes do nome
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`, { headers: { "Accept-Language": "pt-BR" } });
      const hit = ((await r.json()) as any[])[0];
      if (hit) return { lat: Number(hit.lat), lon: Number(hit.lon), label: String(hit.display_name ?? q) };
    } catch { /* próxima consulta */ }
    await new Promise((res) => setTimeout(res, 1100)); // limite do Nominatim: 1 consulta/s
  }
  return null;
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = fail; im.src = src;
});

/** Quadro 16:9 do satélite centrado no ponto (JPEG). */
export async function aerialMosaic(lat: number, lon: number): Promise<Blob> {
  const n = 2 ** Z * TILE;
  const px = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const py = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const x0 = px - W / 2, y0 = py - H / 2;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const jobs: Promise<void>[] = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++)
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++)
      jobs.push(loadImg(tileUrl(tx, ty)).then((im) => ctx.drawImage(im, tx * TILE - x0, ty * TILE - y0)));
  await Promise.all(jobs);
  return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Falha ao montar a vista aérea"))), "image/jpeg", 0.9));
}

/** Fotos do RDO: corrige orientação (EXIF) no envio, giro manual e ordem salva para o PDF. */

const MAX = 2400;

function toJpeg(src: CanvasImageSource, w: number, h: number, rotate = 0): Promise<Blob> {
  const swap = rotate % 180 !== 0;
  const scale = Math.min(1, MAX / Math.max(w, h));
  const dw = Math.round(w * scale), dh = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = swap ? dh : dw;
  canvas.height = swap ? dw : dh;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Falha ao processar a foto"))), "image/jpeg", 0.88));
}

/** Aplica a orientação gravada pela câmera nos pixels, para a foto ficar em pé em qualquer lugar (inclusive no PDF). */
export async function normalizePhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const out = await toJpeg(bmp, bmp.width, bmp.height);
    bmp.close();
    return out;
  } catch {
    return file;
  }
}

/** Gira uma foto já salva em 90° (sentido horário). */
export async function rotatePhoto(url: string): Promise<Blob> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const out = await toJpeg(bmp, bmp.width, bmp.height, 90);
  bmp.close();
  return out;
}

const key = (rdoId: string) => `rdo-media-reversed:${rdoId}`;
export function getMediaReversed(rdoId: string) {
  try { return localStorage.getItem(key(rdoId)) === "1"; } catch { return false; }
}
export function setMediaReversed(rdoId: string, v: boolean) {
  try { localStorage.setItem(key(rdoId), v ? "1" : "0"); } catch { /* ignore */ }
}

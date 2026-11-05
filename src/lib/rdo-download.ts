import JSZip from "jszip";

export type RdoPdfFile = { blob: Blob; filename: string };

/** Freeze the visible IDs before generating; unique archive paths preserve every RDO. */
export async function prepareRdoDownload(
  ids: readonly string[],
  generate: (id: string) => Promise<RdoPdfFile>,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<RdoPdfFile> {
  if (!ids.length) throw new Error("Nenhum RDO encontrado.");
  const zip = ids.length > 1 ? new JSZip() : null;
  for (const [index, id] of ids.entries()) {
    const file = await generate(id);
    onProgress(index + 1, ids.length);
    if (!zip) return file;
    zip.file(`${String(index + 1).padStart(3, "0")}-${file.filename}`, file.blob);
  }
  if (!zip) throw new Error("Nenhum RDO encontrado.");
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "STORE" }),
    filename: `RDOs_filtrados_${new Date().toISOString().slice(0, 10)}.zip`,
  };
}

export function downloadRdoFile({ blob, filename }: RdoPdfFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Called synchronously by the ready button so iOS keeps user activation. */
export async function deliverRdoFile(file: RdoPdfFile) {
  const shareFile = new File([file.blob], file.filename, { type: file.blob.type });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [shareFile] })) {
    try {
      await navigator.share({ files: [shareFile], title: file.filename });
      return;
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
    }
  }
  downloadRdoFile(file);
}
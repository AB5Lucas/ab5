import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { cn } from "@/lib/utils";

/** Imagem da área de transferência (print), ou null se o que foi colado não é imagem. */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) {
        const ext = (f.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
        return new File([f], `print-${Date.now()}.${ext}`, { type: f.type });
      }
    }
  }
  return null;
}

/**
 * Print da solicitação: só colando (Ctrl + V). Aceita o colar com a área focada e também com a página focada
 * enquanto a área está na tela (texto colado num campo segue normal). Mostra a prévia; colar outro substitui.
 */
export function PastePrint({ file, currentUrl, onPaste, disabled, className }: {
  file: File | null; currentUrl?: string | null; onPaste: (f: File) => void; disabled?: boolean; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [notImage, setNotImage] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const cb = useRef(onPaste);
  cb.current = onPaste;
  useEffect(() => {
    if (disabled) return;
    const onDocPaste = (e: ClipboardEvent) => {
      const img = imageFromClipboard(e.clipboardData);
      const inBox = !!box.current && !!e.target && box.current.contains(e.target as Node);
      if (!img) { if (inBox) { e.preventDefault(); setNotImage(true); } return; }
      e.preventDefault();
      setNotImage(false);
      cb.current(img);
    };
    document.addEventListener("paste", onDocPaste);
    return () => document.removeEventListener("paste", onDocPaste);
  }, [disabled]);
  const shown = preview ?? currentUrl ?? null;
  return (
    <div ref={box} tabIndex={disabled ? -1 : 0} role="button" aria-label="Área para colar o print da solicitação (Ctrl + V)"
      onClick={() => box.current?.focus()}
      className={cn(
        "flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-input p-3 text-center text-sm text-muted-foreground outline-none",
        "focus:border-primary focus:bg-primary/5", disabled && "opacity-60", className,
      )}>
      {shown ? (
        <>
          <img src={shown} alt="Print da solicitação" className="max-h-64 max-w-full rounded border border-border object-contain" />
          <span className="text-xs">Para trocar, cole outro print (Ctrl + V).</span>
        </>
      ) : (
        <>
          <ClipboardPaste className="h-6 w-6" />
          <span>Cole aqui o print da solicitação (Ctrl + V)</span>
        </>
      )}
      {notImage && <span className="text-xs text-destructive">O que foi colado não é uma imagem. Copie o print e cole de novo.</span>}
    </div>
  );
}

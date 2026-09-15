import { useRef, useState } from "react";
import { Download, FileSpreadsheet, HelpCircle, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type ImportColumn = {
  /** Cabeçalho esperado na planilha */
  key: string;
  required?: boolean;
  hint?: string;
  example?: string;
};

export type ImportResult = { inserted: number; errors: string[] };

export type ImportRow = Record<string, string>;

const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const sample = clean.split(/\r?\n/)[0] ?? "";
  const delimiter = (sample.match(/;/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

async function readFile(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
    return parseCsv(await file.text());
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return raw
    .map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c))))
    .filter((r) => r.some((v) => v.trim() !== ""));
}

export function ImportDialog({
  entity,
  description,
  columns,
  onImport,
  disabled,
}: {
  /** Nome do que será importado, ex.: "colaboradores" */
  entity: string;
  description?: string;
  columns: ImportColumn[];
  onImport: (rows: ImportRow[]) => Promise<ImportResult>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const instructions = `Colunas esperadas: ${columns
    .map((c) => `${c.key}${c.required ? " (obrigatória)" : ""}`)
    .join(", ")}. A primeira linha da planilha deve conter os títulos das colunas.`;

  const reset = () => {
    setRows([]);
    setFileName("");
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const downloadTemplate = () => {
    const header = columns.map((c) => c.key).join(";");
    const example = columns.map((c) => c.example ?? "").join(";");
    const blob = new Blob(["\uFEFF" + header + "\n" + example + "\n"], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelo-${entity.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    setResult(null);
    try {
      const matrix = await readFile(file);
      if (matrix.length < 2) throw new Error("A planilha precisa ter o cabeçalho e ao menos uma linha de dados.");
      const header = (matrix[0] ?? []).map((h) => normalize(h));
      const mapped = matrix.slice(1).map((line) => {
        const obj: ImportRow = {};
        columns.forEach((col) => {
          const idx = header.indexOf(normalize(col.key));
          obj[col.key] = idx >= 0 ? String(line[idx] ?? "").trim() : "";
        });
        return obj;
      });
      const missing = columns
        .filter((c) => c.required && !header.includes(normalize(c.key)))
        .map((c) => c.key);
      if (missing.length) throw new Error(`Coluna obrigatória ausente na planilha: ${missing.join(", ")}`);
      setRows(mapped);
      setFileName(file.name);
    } catch (e) {
      reset();
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const res = await onImport(rows);
      setResult(res);
      if (res.inserted > 0) toast.success(`${res.inserted} registro(s) importado(s).`);
      if (res.inserted === 0 && res.errors.length) toast.error("Nenhum registro importado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setOpen(true)}
              aria-label={`Importar ${entity} de planilha`}
            >
              <Upload className="h-4 w-4" /> Importar planilha
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm">
            <p className="text-xs leading-relaxed">{instructions}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar {entity}</DialogTitle>
            <DialogDescription>
              {description ?? "Envie um arquivo .xlsx ou .csv seguindo o modelo abaixo."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <HelpCircle className="h-4 w-4" /> Como montar a planilha
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>• A primeira linha deve conter exatamente os títulos das colunas abaixo.</li>
                <li>• Cada linha seguinte é um registro. Colunas opcionais podem ficar em branco.</li>
                <li>• Datas no formato AAAA-MM-DD. Apenas a primeira aba da planilha é lida.</li>
              </ul>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coluna</TableHead>
                      <TableHead>Obrigatória</TableHead>
                      <TableHead>Formato / exemplo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {columns.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell className="font-mono text-xs">{c.key}</TableCell>
                        <TableCell>
                          <Badge variant={c.required ? "default" : "secondary"}>
                            {c.required ? "Sim" : "Não"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.hint ?? ""}
                          {c.example ? ` Ex.: ${c.example}` : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button variant="outline" size="sm" className="mt-3" onClick={downloadTemplate}>
                <Download className="h-4 w-4" /> Baixar modelo (.csv)
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                <FileSpreadsheet className="h-4 w-4" /> Escolher arquivo
              </Button>
              <span className="text-xs text-muted-foreground">
                {fileName ? `${fileName} — ${rows.length} linha(s)` : "Nenhum arquivo selecionado"}
              </span>
            </div>

            {rows.length > 0 && (
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((c) => (
                        <TableHead key={c.key} className="whitespace-nowrap text-xs">
                          {c.key}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 5).map((r, i) => (
                      <TableRow key={i}>
                        {columns.map((c) => (
                          <TableCell key={c.key} className="whitespace-nowrap text-xs">
                            {r[c.key] || "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.length > 5 && (
                  <p className="border-t border-border p-2 text-xs text-muted-foreground">
                    Mostrando 5 de {rows.length} linhas.
                  </p>
                )}
              </div>
            )}

            {result && (
              <div className="rounded-md border border-border p-3 text-sm">
                <p className="font-medium">{result.inserted} registro(s) importado(s).</p>
                {result.errors.length > 0 && (
                  <>
                    <p className="mt-2 text-destructive">{result.errors.length} linha(s) com problema:</p>
                    <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                      {result.errors.slice(0, 50).map((err, i) => (
                        <li key={i}>• {err}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
            <Button onClick={runImport} disabled={rows.length === 0 || busy}>
              {busy ? "Importando..." : `Importar ${rows.length || ""} registro(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

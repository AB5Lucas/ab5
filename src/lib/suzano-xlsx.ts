import apontUrl from "@/assets/templates/suzano-apontamento.xlsx?url";
import prodUrl from "@/assets/templates/suzano-produtividade.xlsx?url";

/**
 * Exportação da Suzano no modelo enviado pelo cliente (fórmulas, tabela, gráfico e formatação preservados).
 * Os modelos (src/assets/templates) são as planilhas do cliente sem os dados; aqui só se trocam as linhas de dados
 * no XML da planilha, copiando o estilo da linha-modelo, e o Excel recalcula tudo ao abrir (fullCalcOnLoad).
 */
const MONTHS = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const excelSerial = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
};
const br = (iso: string) => iso.split("-").reverse().join("/");
const brShort = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y!.slice(2)}`; };

type Val = { n: number } | { s: string } | { f: string; str?: boolean } | null;
const cellXml = (ref: string, style: string | null, v: Val) => {
  const s = style ? ` s="${style}"` : "";
  if (!v) return `<c r="${ref}"${s}/>`;
  if ("n" in v) return Number.isFinite(v.n) ? `<c r="${ref}"${s}><v>${v.n}</v></c>` : `<c r="${ref}"${s}/>`;
  if ("s" in v) return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v.s)}</t></is></c>`;
  return `<c r="${ref}"${s}${v.str ? ' t="str"' : ""}><f>${esc(v.f)}</f></c>`;
};

/** Linha nova a partir da linha-modelo: mesmos atributos e estilos, valores trocados. */
function rowFrom(proto: string, protoRow: number, r: number, vals: Record<string, Val>) {
  const open = proto.match(/^<row [^>]*>/)![0].replace(`r="${protoRow}"`, `r="${r}"`);
  const cells = [...proto.matchAll(/<c r="([A-Z]+)\d+"(?: s="(\d+)")?[^>]*?(?:\/>|>.*?<\/c>)/gs)].map((m) => {
    const col = m[1]!;
    return cellXml(`${col}${r}`, m[2] ?? null, col in vals ? vals[col]! : null);
  });
  return `${open}${cells.join("")}</row>`;
}
const getRow = (xml: string, r: number) => xml.match(new RegExp(`<row r="${r}"[^>]*?(?:/>|>.*?</row>)`, "s"))?.[0] ?? null;
/** Troca o conteúdo de uma célula (mantém o estilo); se a célula não existe, entra no fim da linha. */
function setCell(xml: string, ref: string, v: Val) {
  const re = new RegExp(`<c r="${ref}"(?: s="(\\d+)")?[^>]*?(?:/>|>.*?</c>)`, "s");
  if (re.test(xml)) return xml.replace(re, (_m, s) => cellXml(ref, s ?? null, v));
  if (!v) return xml;
  const row = ref.replace(/^[A-Z]+/, "");
  return xml.replace(new RegExp(`(<row r="${row}"[^>]*>.*?)(</row>)`, "s"), (_m, a, b) => `${a}${cellXml(ref, null, v)}${b}`);
}

async function openTemplate(url: string) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await (await fetch(url)).arrayBuffer());
  const wb = (await zip.file("xl/workbook.xml")!.async("string")).replace(/<calcPr([^/]*)\/>/, (_m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`);
  zip.file("xl/workbook.xml", wb);
  return zip;
}
/** Tira os valores antigos guardados nas fórmulas (o Excel recalcula ao abrir); a de matriz do RESUMO fica. */
async function stripCachedValues(zip: any) {
  for (const path of Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
    const xml: string = await zip.file(path)!.async("string");
    zip.file(path, xml.replace(/(<f(?![^>]*t="array")[^>]*?(?:\/>|>[^<]*<\/f>))<v>[^<]*<\/v>/g, (_m: string, f: string) => f));
  }
}
async function download(zip: any, name: string) {
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export type ApontRow = {
  date: string; name: string; cpf: string; role: string;
  /** Horas normais (vazio = fórmula do modelo: 9 h, sexta 8 h), extras 60%, noturnas e extras 100%, do RDO. */
  normal: number | null; he60: number; night: number; he100: number;
};
export type ApontMeta = { ym: string; lastDate: string; atendimento: string; area: string; responsavel: string; pedido: string; obs: string };

/** Apontamento (abas BM e Apontamento): uma linha por pessoa presente no RDO, com as fórmulas da Tabela5. */
export async function buildSuzanoApontamento(rows: ApontRow[], meta: ApontMeta, url = apontUrl) {
  const zip = await openTemplate(url);
  const path = "xl/worksheets/sheet2.xml";
  let xml = await zip.file(path)!.async("string");
  const proto = getRow(xml, 7)!;
  const T = "Tabela5[[#This Row],";
  const lines = rows.map((r, i) => {
    const n = 7 + i;
    const pedido = /^\d+$/.test(meta.pedido) ? { n: Number(meta.pedido) } : meta.pedido ? { s: meta.pedido } : null;
    return rowFrom(proto, 7, n, {
      A: { n: excelSerial(r.date) }, B: { s: r.name }, C: { s: r.cpf }, D: { s: r.role }, E: { s: meta.atendimento }, F: meta.area ? { s: meta.area } : null,
      G: meta.responsavel ? { s: meta.responsavel } : null, H: pedido, I: meta.obs ? { s: meta.obs } : null,
      J: { f: `IF(${T}[Função]]="ENCARREGADO","67,50",IF(${T}[Função]]="TST","118,28","58,64"))`, str: true },
      K: r.normal == null ? { f: `IF(WEEKDAY(${T}[Data]])=6,8,9)` } : { n: r.normal },
      L: { f: `J${n}*K${n}` },
      M: r.he60 ? { n: r.he60 } : null,
      N: { f: `${T}[R$ Hora Normal]]*${T}[Qtd Horas extras 60%]]*1.6` },
      O: r.night ? { n: r.night } : null,
      P: { f: `J${n}*O${n}/2` },
      Q: r.he100 ? { n: r.he100 } : null,
      R: { f: `J${n}*2*Q${n}` },
      S: { f: `R${n}+P${n}+N${n}+L${n}` },
    });
  });
  const last = 6 + Math.max(1, rows.length);
  xml = xml.replace(proto, () => lines.join("") || proto);
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:S${last}"/>`);
  const [y, m] = meta.ym.split("-");
  xml = setCell(xml, "B1", { s: `${MONTHS[Number(m) - 1]}/${y}` });
  xml = setCell(xml, "C1", { s: `FECHAMENTO EQUIPE ${meta.atendimento}` });
  zip.file(path, xml);
  const tablePath = "xl/tables/table1.xml";
  zip.file(tablePath, (await zip.file(tablePath)!.async("string")).replace(/ref="A6:S\d+"/g, `ref="A6:S${last}"`));
  const bm = "xl/worksheets/sheet1.xml";
  zip.file(bm, setCell(await zip.file(bm)!.async("string"), "F3", { s: `${br(`${meta.ym}-01`)} a ${br(meta.lastDate)}` }));
  const label = meta.atendimento.charAt(0) + meta.atendimento.slice(1).toLowerCase();
  await stripCachedValues(zip);
  return { zip, name: `${label} ${brShort(`${meta.ym}-01`)} a ${brShort(meta.lastDate)}.xlsx` };
}
export async function exportSuzanoApontamento(rows: ApontRow[], meta: ApontMeta) {
  const { zip, name } = await buildSuzanoApontamento(rows, meta);
  await download(zip, name);
}

export type ProdRow = { date: string; ord: string; tag?: string; op: string; l: number; w: number; h: number; vol: number; people: number };

/** Produtividade (abas RESUMO, RDO e MEDIA GERAL): andaimes do RDO; o resumo, a média e o gráfico são as fórmulas do modelo. */
export async function buildSuzanoProdutividade(rows: ProdRow[], ym: string, url = prodUrl) {
  const zip = await openTemplate(url);
  // RDO: uma linha por andaime
  const rdoPath = "xl/worksheets/sheet2.xml";
  let rdo = await zip.file(rdoPath)!.async("string");
  const proto = getRow(rdo, 2)!;
  const lines = rows.map((r, i) => {
    const n = 2 + i;
    return rowFrom(proto, 2, n, {
      A: { n: excelSerial(r.date) }, B: /^\d+$/.test(r.ord) ? { n: Number(r.ord) } : r.ord ? { s: r.ord } : null,
      C: { s: r.op === "desmontagem" ? "Desmontagem" : "Montagem" }, D: { n: r.l }, E: { n: r.w }, F: { n: r.h },
      G: { n: Math.round(r.vol * 100) / 100 }, H: { n: r.people },
      I: { f: `IF(C${n}="MONTAGEM",G${n},0)` }, J: { f: `IF(C${n}="DESMONTAGEM",G${n},0)` }, K: r.tag ? { s: `TAG: ${r.tag}` } : null,
    });
  });
  const lastRdo = 1 + Math.max(1, rows.length);
  rdo = rdo.replace(proto, () => lines.join("") || proto)
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:L${lastRdo}"/>`)
    .replace(/<autoFilter ref="A1:K\d+"/, `<autoFilter ref="A1:K${lastRdo}"`);
  zip.file(rdoPath, rdo);

  // RESUMO: a coluna A é o UNIQUE das datas do RDO (fórmula de matriz do modelo); grava o resultado esperado
  const days = [...new Set(rows.map((r) => r.date))].sort();
  const resPath = "xl/worksheets/sheet1.xml";
  let res = await zip.file(resPath)!.async("string");
  const spillEnd = 5 + days.length;
  res = res.replace(/<f t="array" ref="A5:A\d+">/, `<f t="array" ref="A5:A${spillEnd}">`);
  res = res.replace(/(<c r="A5"[^>]*>.*?<\/f>)<v>[^<]*<\/v>/s, (_m, a) => `${a}<v>${days[0] ? excelSerial(days[0]) : ""}</v>`);
  for (let r = 6; r <= 35; r++) {
    const d = days[r - 5];
    const re = new RegExp(`<c r="A${r}"(?: s="(\\d+)")?[^>]*?(?:/>|>.*?</c>)`, "s");
    if (re.test(res)) res = res.replace(re, (_m, s) => cellXml(`A${r}`, s ?? "41", d ? { n: excelSerial(d) } : null));
    else if (d) res = res.replace(new RegExp(`(<row r="${r}"[^>]*>)`), (_m, a) => `${a}${cellXml(`A${r}`, "41", { n: excelSerial(d) })}`);
  }
  // Período: do dia 1 do mês até o último dia com RDO
  const period = esc(`"PERÍODO: "&TEXT(DATE(YEAR(A5),MONTH(A5),1),"DD/MM/AAAA") &" A "&TEXT(MAX(RDO!$A$2:$A$467),"DD/MM/AAAA")`);
  res = res.replace(/(<c r="A2"[^>]*><f>)[^<]*(<\/f>)/, (_m, a, b) => `${a}${period}${b}`);
  zip.file(resPath, res);

  // MEDIA GERAL: meses do ano filtrado; o mês exportado aponta para a média do RESUMO
  const mgPath = "xl/worksheets/sheet3.xml";
  let mg = await zip.file(mgPath)!.async("string");
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const keepHistory = y === 2026;
  for (let i = 0; i < 12; i++) {
    const r = 3 + i;
    mg = setCell(mg, `A${r}`, { n: excelSerial(`${y}-${String(i + 1).padStart(2, "0")}-01`) });
    if (i + 1 === m) mg = setCell(mg, `B${r}`, { f: "RESUMO!D36" });
    else if (!keepHistory || i + 1 > m) mg = setCell(mg, `B${r}`, null);
  }
  zip.file(mgPath, mg);
  await stripCachedValues(zip);
  return { zip, name: `Produtividade Suzano ${String(m).padStart(2, "0")}-${y}.xlsx` };
}
export async function exportSuzanoProdutividade(rows: ProdRow[], ym: string) {
  const { zip, name } = await buildSuzanoProdutividade(rows, ym);
  await download(zip, name);
}

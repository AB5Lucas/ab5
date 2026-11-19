import { jsPDF } from "jspdf";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";
import { SC_REPORT_COLUMNS, type ScReportRow } from "@/lib/sc-report";

/** Relação de SCs em PDF (A4 horizontal), com cabeçalho repetido e grupos. */
export async function exportScReportPdf(groups: { group: string; rows: ScReportRow[] }[], subtitle: string, filename: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  let logo: string | null = null;
  try {
    const blob = await (await fetch(ab5Logo.url)).blob();
    logo = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
  } catch { logo = null; }
  const margin = 12, right = 285, bottom = 196;
  let y = 0;
  const header = () => {
    if (logo) { const im = doc.getImageProperties(logo); doc.addImage(logo, "PNG", margin, 8, 22, 22 * im.height / im.width); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Relação de SCs", 40, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(subtitle, 240) as string[];
    doc.text(lines, 40, 20);
    y = Math.max(32, 20 + lines.length * 4 + 4);
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.8);
    let x = margin;
    for (const c of SC_REPORT_COLUMNS) { doc.text(doc.splitTextToSize(c.label, c.width - 1.5) as string[], x + 0.8, y + 3); x += c.width; }
    y += 7; doc.setLineWidth(0.25); doc.line(margin, y, right, y);
    doc.setFont("helvetica", "normal");
  };
  header();
  let total = 0;
  for (const g of groups) {
    if (g.group) {
      if (y + 12 > bottom) { doc.addPage(); header(); }
      doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      doc.setFillColor(235, 235, 235); doc.rect(margin, y + 0.5, right - margin, 5, "F");
      doc.text(`${g.group} (${g.rows.length})`, margin + 1, y + 4.2);
      y += 6.5; doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(6.6);
    for (const r of g.rows) {
      const cells = SC_REPORT_COLUMNS.map((c) => doc.splitTextToSize(String(r[c.key] ?? "—"), c.width - 1.5) as string[]);
      const h = Math.max(5.5, ...cells.map((l) => l.length * 2.8 + 2.2));
      if (y + h > bottom) { doc.addPage(); header(); doc.setFontSize(6.6); }
      let x = margin;
      cells.forEach((l, i) => { doc.text(l, x + 0.8, y + 3.3); x += SC_REPORT_COLUMNS[i]!.width; });
      y += h; doc.setDrawColor(210); doc.line(margin, y, right, y); doc.setDrawColor(0);
      total++;
    }
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5);
    doc.text(`${total} linha(s) · emitido em ${new Date().toLocaleString("pt-BR")}`, margin, 204);
    doc.text(`Página ${i} de ${pages}`, right, 204, { align: "right" });
  }
  doc.save(filename);
}

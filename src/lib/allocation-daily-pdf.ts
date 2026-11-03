import { jsPDF } from "jspdf";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";

type DailyAllocation = {
  collaborator_id: string | null;
  daily_schedules: { schedule_date: string } | null;
};

export function filteredDailyAllocations<T extends DailyAllocation>(rows: T[], person: string) {
  return rows.filter((row) => row.collaborator_id === person)
    .sort((a, b) => (a.daily_schedules?.schedule_date ?? "").localeCompare(b.daily_schedules?.schedule_date ?? ""));
}

export async function exportAllocationDailyPdf(person: string, period: string, rows: string[][], filename: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const response = await fetch(ab5Logo.url);
  if (!response.ok) throw new Error("Não foi possível carregar o logo");
  const blob = await response.blob();
  const logo = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler o logo"));
    reader.readAsDataURL(blob);
  });
  const image = doc.getImageProperties(logo);
  const widths = [25, 40, 64, 98, 23, 23];
  const labels = ["Data", "Pedido", "Cliente", "Serviço", "Pernoite", "Motorista"];
  const margin = 12;
  const bottom = 194;
  let y = 0;
  const header = () => {
    doc.addImage(logo, "PNG", margin, 10, 25, 25 * image.height / image.width);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Alocações · Dia a dia", 44, 17);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const nameLines = doc.splitTextToSize(person, 240) as string[];
    doc.text(nameLines, 44, 24);
    const periodY = 24 + nameLines.length * 4.5;
    doc.text(period, 44, periodY);
    y = Math.max(38, periodY + 8);
    doc.setFont("helvetica", "bold");
    let x = margin;
    labels.forEach((label, i) => {
      doc.text(label, x + 2, y + 5);
      x += widths[i] ?? 0;
    });
    y += 9;
    doc.setLineWidth(0.2);
    doc.line(margin, y, 285, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
  };
  header();
  for (const row of rows) {
    const cells = widths.map((width, i) => doc.splitTextToSize(row[i] ?? "—", width - 4) as string[]);
    const height = Math.max(9, ...cells.map((lines) => lines.length * 4.2 + 4));
    if (y + height > bottom) { doc.addPage(); header(); }
    let x = margin;
    cells.forEach((lines, i) => {
      doc.text(lines, x + 2, y + 5);
      x += widths[i] ?? 0;
    });
    y += height;
    doc.line(margin, y, 285, y);
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.text(`${rows.length} alocações`, margin, 203);
    doc.text(`Página ${page} de ${pages}`, 285, 203, { align: "right" });
  }
  doc.save(filename);
}
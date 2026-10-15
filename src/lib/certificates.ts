import { jsPDF } from "jspdf";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";

export type CertKind = "inicial" | "renovacao" | "conferir";
export const KIND_LABEL: Record<CertKind, string> = {
  inicial: "Inicial",
  renovacao: "Renovação",
  conferir: "Conferir",
};

/** Dados congelados no momento da emissão (não mudam se o cadastro mudar depois). */
export type CertSnapshot = {
  name: string;
  cpf: string;
  registration?: string | null;
  trainingName: string;
  subject: string;
  kind: "inicial" | "renovacao";
  phrase: string;
  legalBasis: string;
  hours: number;
  date: string; // AAAA-MM-DD
  location: string;
  program: string;
  tstName: string;
  tstTitle: string;
};

export type ListSnapshot = {
  subject: string;
  tstName: string;
  date: string;
  schedule: string;
  hours: number;
  people: { name: string; cpf: string }[];
};

const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function formatCpf(cpf?: string | null) {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
export const brDate = (iso: string) => iso.split("-").reverse().join("/");
export function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS[(m ?? 1) - 1]} de ${y}`;
}

/** Inicial se não há registro anterior do mesmo treinamento; renovação se há; conferir se há duplicidade no mesmo dia. */
export function classifyKind(dates: string[], date: string): CertKind {
  const same = dates.filter((d) => d === date).length;
  if (same > 1) return "conferir";
  return dates.some((d) => d < date) ? "renovacao" : "inicial";
}

export function buildPhrase(template: string, kind: "inicial" | "renovacao") {
  return template.replace(/\{tipo\}/g, kind === "inicial" ? "Inicial" : "Periódico");
}

async function logo(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const blob = await (await fetch(ab5Logo.url)).blob();
    const data = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(blob);
    });
    const s = await new Promise<{ w: number; h: number }>((res) => {
      const i = new Image();
      i.onload = () => res({ w: i.width, h: i.height });
      i.onerror = () => res({ w: 3, h: 1 });
      i.src = data;
    });
    return { data, ...s };
  } catch {
    return null;
  }
}

const COMPANY = [
  "AB5 Indústria e Comércio Ltda.",
  "CNPJ: 03.102.481/0001-34. Inscrição Estadual: 455.143.410.113.",
  "Av. Min. Roberto Cardoso Alves, 1215 – Parque Industrial – Mogi Guaçu - SP.",
  "Telefone para contato: (019)3841-3500.",
];

function certHeader(doc: jsPDF, lg: Awaited<ReturnType<typeof logo>>, W: number) {
  doc.setDrawColor(20, 30, 210);
  doc.setLineWidth(1.2);
  doc.roundedRect(18, 18, W - 36, 180, 14, 14);
  let y = 30;
  if (lg) {
    const h = 9;
    const w = (lg.w / lg.h) * h;
    doc.addImage(lg.data, "PNG", W / 2 - w / 2, y, w, h);
  }
  y += 14;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("AB5 Industria e Comércio Ltda.", W / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  COMPANY.forEach((l, i) => doc.text(l, W / 2, y + 4 + i * 3, { align: "center" }));
}

function drawCert(doc: jsPDF, s: CertSnapshot, lg: Awaited<ReturnType<typeof logo>>) {
  const W = doc.internal.pageSize.getWidth();
  certHeader(doc, lg, W);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.text("Certificado", W / 2, 80, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(`${s.name} - ${s.cpf}`, W / 2, 93, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(doc.splitTextToSize(s.phrase, W - 70), W / 2, 106, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const body = `Ministrado pelo Centro de Treinamentos desta empresa, conforme estabelece ${s.legalBasis} com carga horária de ${s.hours} horas realizado no dia ${brDate(s.date)}.`;
  doc.text(doc.splitTextToSize(body, W - 110), W / 2, 113, { align: "center" });
  doc.setFontSize(11);
  doc.text(`${s.location}, ${longDate(s.date)}`, W / 2, 135, { align: "center" });
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  const lx = 45, rx = W - 45 - 85;
  doc.line(lx, 165, lx + 85, 165);
  doc.line(rx, 165, rx + 85, 165);
  doc.setFontSize(7.5);
  doc.text(s.name, lx + 42.5, 171, { align: "center" });
  doc.text(`CPF: ${s.cpf}`, lx + 42.5, 175, { align: "center" });
  doc.text("Instrutor/Responsável Técnico", rx + 42.5, 171, { align: "center" });
  doc.text(s.tstName, rx + 42.5, 175, { align: "center" });
  doc.text(s.tstTitle, rx + 42.5, 179, { align: "center" });

  // Verso: conteúdo programático
  doc.addPage();
  certHeader(doc, lg, W);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Conteúdo Programático Teórico do Treinamento: ${s.hours} horas.`, 30, 70);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let y = 79;
  s.program.split("\n").filter(Boolean).forEach((line) => {
    const m = line.match(/^\s*([\d.]+)\s+(.*)$/);
    if (m) {
      doc.text(m[1]!, 34, y);
      doc.text(doc.splitTextToSize(m[2]!, W - 90), 50, y);
    } else doc.text(doc.splitTextToSize(line, W - 70), 34, y);
    y += 5.5;
  });
  doc.setFontSize(11);
  doc.text(`${s.location}, ${longDate(s.date)}`, W / 2, Math.max(y + 10, 175), { align: "center" });
}

export async function certificatesPdf(list: CertSnapshot[], fileName: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const lg = await logo();
  list.forEach((s, i) => {
    if (i > 0) doc.addPage();
    drawCert(doc, s, lg);
  });
  return { doc, fileName };
}

export async function attendancePdf(lists: ListSnapshot[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const lg = await logo();
  const W = doc.internal.pageSize.getWidth();
  const L = 15, R = W - 15, CW = R - L;
  let first = true;
  for (const s of lists) {
    for (let start = 0; start === 0 || start < s.people.length; start += 15) {
      if (!first) doc.addPage();
      first = false;
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.setTextColor(0);
      // Cabeçalho
      doc.rect(L, 12, CW, 22);
      doc.line(L, 23, R - 40, 23);
      doc.line(R - 40, 12, R - 40, 34);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("SISTEMA DE GESTÃO DA QUALIDADE", L + (CW - 40) / 2, 19.5, { align: "center" });
      doc.setFontSize(11);
      doc.text("REGISTRO DE PRESENÇA", L + (CW - 40) / 2, 30.5, { align: "center" });
      if (lg) {
        const h = 10, w = Math.min(34, (lg.w / lg.h) * h);
        doc.addImage(lg.data, "PNG", R - 20 - w / 2, 18, w, h);
      }
      doc.rect(L, 38, CW, 16);
      doc.line(L, 46, R, 46);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("INTEGRAÇÃO( ) REUNIÃO( ) TREINAMENTO( X ) ORIENTAÇÃO( ) OUTROS______________", L + 3, 43);
      doc.text("PROVA TEÓRICA (     )        PROVA PRÁTICA (   )", W / 2, 51.5, { align: "center" });
      // Dados
      doc.rect(L, 59, CW, 18);
      [65, 71].forEach((y) => doc.line(L, y, R, y));
      doc.line(L + 35, 59, L + 35, 71);
      doc.line(L + 35, 71, L + 35, 77);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.text("ASSUNTO:", L + 2, 63.2);
      doc.text("INSTRUTOR:", L + 2, 69.2);
      doc.text("DATA:", L + 2, 75.2);
      doc.text("HORÁRIO:", L + 75, 75.2);
      doc.text("DURAÇÃO:", L + 140, 75.2);
      [L + 73, L + 103, L + 138, L + 156].forEach((x) => doc.line(x, 71, x, 77));
      doc.setFont("helvetica", "normal");
      doc.text(s.subject, L + 37, 63.2);
      doc.text(s.tstName, L + 37, 69.2);
      doc.text(brDate(s.date), L + 37, 75.2);
      doc.text(s.schedule || "", L + 105, 75.2);
      doc.text(`${s.hours} HORAS`, L + 158, 75.2);
      // Participantes
      const top = 82, rh = 6.2;
      const cols = [L, L + 12, L + 92, L + 130, R];
      doc.setFillColor(225, 225, 225);
      doc.rect(L, top, CW, rh, "FD");
      doc.rect(L, top + rh, CW, rh);
      doc.setFont("helvetica", "bold");
      doc.text("PARTICIPANTES", W / 2, top + 4.3, { align: "center" });
      const hy = top + rh;
      ["Nº", "NOME", "RG / CPF", "VISTO"].forEach((t, i) => doc.text(t, (cols[i]! + cols[i + 1]!) / 2, hy + 4.3, { align: "center" }));
      for (let i = 0; i < 15; i++) {
        const y = hy + rh * (i + 1);
        doc.rect(L, y, CW, rh);
        const p = s.people[start + i];
        doc.setFont("helvetica", "bold");
        doc.text(String(start + i + 1), (cols[0]! + cols[1]!) / 2, y + 4.3, { align: "center" });
        if (p) {
          doc.setFont("helvetica", "normal");
          doc.text(doc.splitTextToSize(p.name, 78)[0], cols[1]! + 1, y + 4.3);
          doc.setFont("helvetica", "bold");
          doc.text(p.cpf, (cols[2]! + cols[3]!) / 2, y + 4.3, { align: "center" });
        }
      }
      const bottom = hy + rh * 16;
      cols.slice(1, 4).forEach((x) => doc.line(x, hy, x, bottom));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("VISTO DO INSTRUTOR: ________________________________", W / 2, bottom + 20, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.line(L, 262, R, 262);
      doc.text("FR-RHU-009 Rev. 00", L, 266);
      doc.text("Aprovado em 11/08/2021", R, 266, { align: "right" });
    }
  }
  return doc;
}

export function openPdf(doc: jsPDF) {
  const url = doc.output("bloburl");
  window.open(String(url), "_blank");
}

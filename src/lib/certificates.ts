import { jsPDF } from "jspdf";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";
import nr06 from "@/assets/nr/nr06.png";
import nr12 from "@/assets/nr/nr12.png";
import nr18 from "@/assets/nr/nr18.png";
import nr20 from "@/assets/nr/nr20.png";
import nr26 from "@/assets/nr/nr26.png";
import nr33 from "@/assets/nr/nr33.png";
import nr34 from "@/assets/nr/nr34.png";
import nr35 from "@/assets/nr/nr35.png";


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

const NR_BADGES: Record<string, string> = {
  "06": nr06, "12": nr12, "18": nr18, "20": nr20, "26": nr26, "33": nr33, "34": nr34, "35": nr35,
};

async function toDataUrl(url: string) {
  const blob = await (await fetch(url)).blob();
  return new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(blob);
  });
}

/** Etiqueta da NR (canto superior esquerdo), a partir do nome do treinamento. */
async function badgeFor(trainingName: string): Promise<string | null> {
  const m = trainingName.match(/NR\s*-?\s*(\d{1,2})/i);
  if (!m) return null;
  const url = NR_BADGES[m[1]!.padStart(2, "0")];
  if (!url) return null;
  try { return await toDataUrl(url); } catch { return null; }
}

function certHeader(doc: jsPDF, lg: Awaited<ReturnType<typeof logo>>, W: number, badge?: string | null) {
  doc.setDrawColor(20, 30, 210);
  doc.setLineWidth(1.2);
  doc.roundedRect(18, 18, W - 36, 180, 14, 14);
  if (badge) doc.addImage(badge, "PNG", 30, 28, 24, 24);
  let y = 26;
  if (lg) {
    const h = 18;
    const w = (lg.w / lg.h) * h;
    doc.addImage(lg.data, "PNG", W / 2 - w / 2, y, w, h);
  }
  y += 23;
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("AB5 Industria e Comércio Ltda.", W / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  COMPANY.forEach((l, i) => doc.text(l, W / 2, y + 4 + i * 3, { align: "center" }));
}

function drawCert(doc: jsPDF, s: CertSnapshot, lg: Awaited<ReturnType<typeof logo>>, badge: string | null) {
  const W = doc.internal.pageSize.getWidth();
  certHeader(doc, lg, W, badge);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.text("Certificado", W / 2, 80, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(`${s.name} - ${s.cpf}`, W / 2, 93, { align: "center" });
  const body = `Ministrado pelo Centro de Treinamentos desta empresa, conforme estabelece ${s.legalBasis} com carga horária de ${s.hours} horas realizado no dia ${brDate(s.date)}.`;
  // Ajusta a fonte para frase + texto caberem entre o nome (y≈100) e a data (y≈130)
  let fs = 9.5;
  let pl: string[] = [], bl: string[] = [];
  const lh = (f: number) => f * 0.3528 * 1.15;
  for (; fs >= 6; fs -= 0.25) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(fs);
    pl = doc.splitTextToSize(s.phrase, W - 60);
    doc.setFont("helvetica", "normal"); doc.setFontSize(fs - 0.5);
    bl = doc.splitTextToSize(body, W - 90);
    if (pl.length * lh(fs) + bl.length * lh(fs - 0.5) + 2 <= 28) break;
  }
  let ty = 103;
  doc.setFont("helvetica", "bold"); doc.setFontSize(fs);
  doc.text(pl, W / 2, ty, { align: "center", lineHeightFactor: 1.15 });
  ty += pl.length * lh(fs) + 2;
  doc.setFont("helvetica", "normal"); doc.setFontSize(fs - 0.5);
  doc.text(bl, W / 2, ty, { align: "center", lineHeightFactor: 1.15 });
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
  certHeader(doc, lg, W, badge);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Conteúdo Programático Teórico do Treinamento: ${s.hours} horas.`, 30, 70);
  doc.setFont("helvetica", "normal");
  const lines = s.program.split("\n").filter(Boolean).map((line) => {
    const m = line.match(/^\s*([\d.]+)\s+(.*)$/);
    return m ? { n: m[1]!, t: m[2]!, x: 50, w: W - 90 } : { n: "", t: line, x: 34, w: W - 70 };
  });
  // Ajusta a fonte para o conteúdo caber entre y=76 e y=180 (data em 188)
  let pf = 9;
  const layout = (f: number) => { doc.setFontSize(f); return lines.map((l) => doc.splitTextToSize(l.t, l.w) as string[]); };
  let wrapped = layout(pf);
  const total = (f: number, w: string[][]) => w.reduce((a, x) => a + x.length * f * 0.3528 * 1.15 + f * 0.15, 0);
  while (pf > 5 && total(pf, wrapped) > 104) { pf -= 0.25; wrapped = layout(pf); }
  doc.setFontSize(pf);
  let y = 79;
  lines.forEach((l, i) => {
    if (l.n) doc.text(l.n, 34, y);
    doc.text(wrapped[i]!, l.x, y, { lineHeightFactor: 1.15 });
    y += wrapped[i]!.length * pf * 0.3528 * 1.15 + pf * 0.15;
  });
  doc.setFontSize(11);
  doc.text(`${s.location}, ${longDate(s.date)}`, W / 2, 188, { align: "center" });
}

const NAMES = new WeakMap<jsPDF, string>();
/** Padrão de arquivo: NR33 - Nome - DD-MM-AAAA */
export function certFileName(s: CertSnapshot) {
  const m = s.trainingName.match(/NR\s*-?\s*(\d{1,2})/i);
  const nr = m ? `NR${m[1]!.padStart(2, "0")}` : s.trainingName;
  return `${nr} - ${s.name} - ${brDate(s.date).replace(/\//g, "-")}`.replace(/[\\/:*?"<>|]/g, "");
}

export async function certificatesPdf(list: CertSnapshot[], fileName: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const lg = await logo();
  const badges = new Map<string, string | null>();
  for (const s of list) if (!badges.has(s.trainingName)) badges.set(s.trainingName, await badgeFor(s.trainingName));
  list.forEach((s, i) => {
    if (i > 0) doc.addPage();
    drawCert(doc, s, lg, badges.get(s.trainingName) ?? null);
  });
  const name = fileName || (list.length === 1 ? certFileName(list[0]!) : list.length ? `${certFileName(list[0]!).split(" - ")[0]} - Certificados - ${brDate(list[0]!.date).replace(/\//g, "-")}` : "Certificados");
  NAMES.set(doc, name);
  return { doc, fileName: name };
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
        let h = 18, w = (lg.w / lg.h) * h;
        if (w > 36) { w = 36; h = (lg.h / lg.w) * w; }
        doc.addImage(lg.data, "PNG", R - 20 - w / 2, 23 - h / 2, w, h);
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

/**
 * Mostra o PDF numa janela dentro do sistema, desenhando as páginas como imagens
 * (o Edge bloqueia o leitor de PDF em nova aba e dentro de quadros).
 */
export async function openPdf(doc: jsPDF) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;flex-direction:column;padding:16px;gap:8px";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;justify-content:flex-end;gap:8px";
  const mkBtn = (label: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "background:#fff;color:#111;border-radius:6px;padding:6px 14px;font-size:14px;font-weight:500;cursor:pointer";
    return b;
  };
  const dl = mkBtn("Baixar");
  dl.onclick = () => doc.save(`${NAMES.get(doc) ?? "documento"}.pdf`);
  const close = mkBtn("Fechar");
  close.onclick = () => overlay.remove();
  bar.append(dl, close);
  const pages = document.createElement("div");
  pages.style.cssText = "flex:1;overflow:auto;display:flex;flex-direction:column;align-items:center;gap:12px;color:#fff";
  pages.textContent = "Carregando…";
  overlay.append(bar, pages);
  document.body.appendChild(overlay);
  try {
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(doc.output("arraybuffer")) }).promise;
    pages.textContent = "";
    const width = Math.min(pages.clientWidth - 16, 1100);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = (width / base.width) * (window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.cssText = `width:${width}px;background:#fff;border-radius:4px;box-shadow:0 2px 12px rgba(0,0,0,.4)`;
      pages.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    }
  } catch (e) {
    pages.textContent = "Não foi possível mostrar a pré-visualização. Use o botão Baixar.";
    console.error(e);
  }
}

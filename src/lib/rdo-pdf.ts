import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { RDO_STATUS_LABEL, SCAFFOLD_OPS, reasonLabel, positionLabel } from "@/lib/rdo";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";

/** Remove o fundo branco do logo e aplica um contorno branco (para fundo escuro). */
async function logoForDark(): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const src = await toDataUrl(ab5Logo.url);
    if (!src) return null;
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    const pad = 10;
    const w = img.width + pad * 2;
    const h = img.height + pad * 2;
    const base = document.createElement("canvas");
    base.width = w;
    base.height = h;
    const bc = base.getContext("2d")!;
    bc.drawImage(img, pad, pad);
    const d = bc.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const m = Math.min(d.data[i]!, d.data[i + 1]!, d.data[i + 2]!);
      if (m > 225) d.data[i + 3] = 0;
      else if (m > 190) d.data[i + 3] = Math.round((d.data[i + 3]! * (225 - m)) / 35);
    }
    bc.putImageData(d, 0, 0);
    // silhueta branca
    const sil = document.createElement("canvas");
    sil.width = w;
    sil.height = h;
    const sc = sil.getContext("2d")!;
    sc.drawImage(base, 0, 0);
    sc.globalCompositeOperation = "source-in";
    sc.fillStyle = "#ffffff";
    sc.fillRect(0, 0, w, h);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const oc = out.getContext("2d")!;
    const r = Math.max(3, Math.round(img.width / 90));
    for (let a = 0; a < 360; a += 20) {
      const rad = (a * Math.PI) / 180;
      oc.drawImage(sil, Math.cos(rad) * r, Math.sin(rad) * r);
    }
    oc.drawImage(base, 0, 0);
    return { data: out.toDataURL("image/png"), w, h };
  } catch {
    return null;
  }
}
import { formatDateBR } from "@/lib/scheduling";

const RED: [number, number, number] = [200, 16, 46];
const DARK: [number, number, number] = [20, 20, 20];
const GREY: [number, number, number] = [110, 110, 110];

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function imgSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ w: i.width, h: i.height });
    i.onerror = () => res({ w: 4, h: 3 });
    i.src = dataUrl;
  });
}

export async function exportRdoPdf(rdoId: string) {
  const [{ data: rdo }, { data: team }, { data: scaffolds }, { data: media }, { data: sigs }] =
    await Promise.all([
      supabase.from("rdos").select("*, works(name, clients(name))").eq("id", rdoId).single(),
      supabase
        .from("rdo_workforce")
        .select("*, collaborators(full_name, registration_number), positions(name)")
        .eq("rdo_id", rdoId),
      supabase.from("rdo_scaffolds").select("*").eq("rdo_id", rdoId).order("created_at"),
      supabase.from("rdo_media").select("*").eq("rdo_id", rdoId).order("created_at"),
      supabase.from("rdo_signatures").select("*").eq("rdo_id", rdoId),
    ]);
  if (!rdo) throw new Error("RDO não encontrado");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const M = 14;
  let y = 0;

  const ensure = (h: number) => {
    if (y + h > 282) {
      doc.addPage();
      y = 16;
    }
  };
  let secN = 0;
  const section = (title: string) => {
    const n = ++secN;
    ensure(14);
    y += 4;
    doc.setFillColor(...RED);
    doc.rect(M, y, 2, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...DARK);
    doc.text(`${n} — ${title.toUpperCase()}`, M + 4, y + 4.6);
    y += 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
  };
  const para = (text: string) => {
    const lines = doc.splitTextToSize(text || "—", W - 2 * M);
    for (const l of lines) {
      ensure(5);
      doc.text(l, M, y);
      y += 4.5;
    }
  };
  const table = (head: string[], widths: number[], rows: string[][]) => {
    const row = (cells: string[], bold = false) => {
      const wrapped = cells.map((c, i) => doc.splitTextToSize(c || "—", widths[i]! - 2));
      const h = Math.max(...wrapped.map((w) => w.length)) * 4 + 2;
      ensure(h);
      let x = M;
      if (bold) {
        doc.setFillColor(240, 240, 240);
        doc.rect(M, y - 3.5, W - 2 * M, h, "F");
      }
      doc.setFont("helvetica", bold ? "bold" : "normal");
      wrapped.forEach((w, i) => {
        doc.text(w, x + 1, y);
        x += widths[i]!;
      });
      doc.setDrawColor(225, 225, 225);
      doc.line(M, y - 3.5 + h, W - M, y - 3.5 + h);
      y += h;
    };
    row(head, true);
    rows.forEach((r) => row(r));
    doc.setFont("helvetica", "normal");
  };

  // Cabeçalho
  doc.setFillColor(...DARK);
  doc.rect(0, 0, W, 30, "F");
  const logoData = await toDataUrl(ab5Logo.url);
  let tx = M;
  {
    const lh = 18;
    const s = logoData ? await imgSize(logoData) : { w: 3, h: 1 };
    const lw = (s.w / s.h) * lh;
    const top = M + lw + 12; // largura no topo
    const bottom = top - 8; // inclinação
    doc.setFillColor(255, 255, 255);
    doc.lines([[top, 0], [bottom - top, 30], [-bottom, 0]], 0, 0, [1, 1], "F", true);
    // fios vermelhos finos (traço vetorial com pontas arredondadas, sem serrilhado)
    doc.setDrawColor(...RED);
    doc.setLineWidth(0.6);
    doc.setLineCap("round");
    doc.setLineJoin("round");
    doc.line(top + 0.3, -1, bottom + 0.3, 30);
    doc.line(0, 30.3, W, 30.3);
    doc.setLineWidth(0.2);
    doc.setLineCap("butt");
    if (logoData) {
      try {
        doc.addImage(logoData, "PNG", M, 6, lw, lh);
      } catch {
        /* ignora */
      }
    }
    tx = top + 4;
  }
  void logoForDark;
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("RELATÓRIO DIÁRIO DE OBRAS", tx, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`RDO Nº ${String(rdo.number ?? "").padStart(4, "0")}`, tx, 21);
  doc.text(formatDateBR(rdo.report_date), W - M, 15, { align: "right" });
  doc.text(RDO_STATUS_LABEL[rdo.status] ?? rdo.status, W - M, 21, { align: "right" });
  doc.setTextColor(...DARK);
  y = 40;

  const work = rdo.works as { name: string; clients: { name: string } | null } | null;
  section("Identificação");
  table(
    ["RDO Nº", "Obra", "Cliente", "Data", "Responsável"],
    [18, 52, 42, 25, 45],
    [[String(rdo.number ?? ""), work?.name ?? "—", work?.clients?.name ?? "—", formatDateBR(rdo.report_date), rdo.responsible_name ?? "—"]],
  );

  if (rdo.activities?.trim() || (scaffolds ?? []).length) {
    section("Atividades");
    if (rdo.activities?.trim()) para(rdo.activities);
   if ((scaffolds ?? []).length) {
     ensure(8);
     doc.setFont("helvetica", "bold");
     doc.text("Andaimes", M, y + 1);
     y += 5;
     table(
       ["Tipo", "Local", "C×L×A (m)", "Qtd.", "Operação", "Obs."],
       [30, 34, 30, 14, 26, 48],
       (scaffolds ?? []).map((s) => [
         s.scaffold_type ?? "",
         s.location ?? "",
         [s.length_m, s.width_m, s.height_m].map((v) => v ?? "-").join(" × "),
         String(s.quantity),
         SCAFFOLD_OPS.find((o) => o.key === s.operation)?.label ?? s.operation,
         s.notes ?? "",
       ]),
     );
   }
  }

  section("Efetivo");
  const t = (team ?? []).slice().sort((a, b) =>
    (a.collaborators?.full_name ?? "").localeCompare(b.collaborators?.full_name ?? "", "pt-BR"),
  );
  const present = t.filter((r) => r.present);
  const absent = t.filter((r) => !r.present);
  table(
    ["Colaborador", "Função", "Entrada", "Saída", "Intervalo", "Horas"],
    [60, 44, 20, 20, 20, 18],
    present.map((r) => [
      r.collaborators?.full_name ?? "—",
      positionLabel(r.positions?.name) ?? "—",
      r.entry_time?.slice(0, 5) ?? "—",
      r.exit_time?.slice(0, 5) ?? "—",
      `${r.break_minutes / 60}h`,
      String(r.worked_hours ?? 0).replace(".", ","),
    ]),
  );
  const total = present.reduce((s, r) => s + Number(r.worked_hours ?? 0), 0);
  ensure(6);
  doc.setFont("helvetica", "bold");
  doc.text(`Presentes: ${present.length} de ${t.length} previstos · Total ${total.toFixed(2).replace(".", ",")} h`, M, y + 1);
  y += 6;
  doc.setFont("helvetica", "normal");
  if (absent.length) {
    ensure(8);
    doc.setTextColor(...RED);
    doc.text("Ausências", M, y + 1);
    doc.setTextColor(...DARK);
    y += 5;
    table(
      ["Colaborador", "Motivo informado", "Classificação"],
      [70, 70, 42],
      absent.map((r) => [
        r.collaborators?.full_name ?? "—",
        reasonLabel(r.reported_reason, r.reported_note),
        r.final_classification ? reasonLabel(r.final_classification) : "Aguardando",
      ]),
    );
  }

  if (rdo.notes?.trim()) {
    section("Observações");
    para(rdo.notes);
  }

  const photos = (media ?? []).filter((m) => m.kind === "photo");
  const videos = (media ?? []).filter((m) => m.kind === "video");
  if (photos.length || videos.length) section("Registro fotográfico");
  const colW = (W - 2 * M - 6) / 2;
  let col = 0;
  for (const p of photos) {
    const { data } = await supabase.storage.from("rdo-media").createSignedUrl(p.storage_path, 600);
    const d = data?.signedUrl ? await toDataUrl(data.signedUrl) : null;
    if (!d) continue;
    const s = await imgSize(d);
    const h = Math.min(70, (colW * s.h) / s.w);
    const cap = p.description ? doc.splitTextToSize(p.description, colW) : [];
    const block = h + cap.length * 4 + 4;
    if (col === 0) ensure(block);
    const x = M + col * (colW + 6);
    try {
      doc.addImage(d, x, y, colW, h);
    } catch {
      /* formato não suportado */
    }
    if (cap.length) {
      doc.setTextColor(...GREY);
      doc.text(cap, x, y + h + 4);
      doc.setTextColor(...DARK);
    }
    if (col === 1) y += block + 2;
    col = col === 0 ? 1 : 0;
  }
  if (col === 1) y += 76;
  // (sem fotos: seção omitida)
  if (videos.length) para(`${videos.length} vídeo(s) anexado(s) ao RDO no sistema.`);

  section("Assinaturas");
  ensure(45);
  const sw = (W - 2 * M - 10) / 2;
  (["ab5", "client"] as const).forEach((kind, i) => {
    const s = (sigs ?? []).find((x) => x.kind === kind);
    const x = M + i * (sw + 10);
    if (s) {
      try {
        doc.addImage(s.signature_data, "PNG", x, y, sw, 25);
      } catch {
        /* ignora */
      }
    }
    doc.setDrawColor(...DARK);
    doc.line(x, y + 27, x + sw, y + 27);
    doc.setFont("helvetica", "bold");
    doc.text(kind === "ab5" ? "RESPONSÁVEL AB5" : "RESPONSÁVEL CLIENTE", x, y + 32);
    doc.setFont("helvetica", "normal");
    doc.text(s ? `${s.signer_name} · ${new Date(s.signed_at).toLocaleString("pt-BR")}` : "Não assinado", x, y + 37);
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(`AB5 · RDO Nº ${rdo.number ?? ""} · ${work?.name ?? ""} · ${formatDateBR(rdo.report_date)}`, M, 292);
    doc.text(`${i}/${pages}`, W - M, 292, { align: "right" });
  }
  doc.save(`RDO_${rdo.number ?? ""}_${(work?.name ?? "obra").replace(/\W+/g, "_")}_${rdo.report_date}.pdf`);
}

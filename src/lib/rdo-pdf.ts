import { jsPDF } from "jspdf";
import { supabase } from "@/integrations/supabase/client";
import { RDO_STATUS_LABEL, SCAFFOLD_OPS, SERVICE_CATEGORIES, reasonLabel } from "@/lib/rdo";
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
  const [{ data: rdo }, { data: team }, { data: services }, { data: scaffolds }, { data: media }, { data: sigs }] =
    await Promise.all([
      supabase.from("rdos").select("*, works(name, clients(name))").eq("id", rdoId).single(),
      supabase
        .from("rdo_workforce")
        .select("*, collaborators(full_name, registration_number), positions(name)")
        .eq("rdo_id", rdoId),
      supabase.from("rdo_services").select("*").eq("rdo_id", rdoId).order("created_at"),
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
  const section = (n: number, title: string) => {
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
  doc.setFillColor(...RED);
  doc.rect(0, 30, W, 1.5, "F");
  doc.setFillColor(...RED);
  doc.roundedRect(M, 8, 16, 14, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("AB5", M + 8, 17, { align: "center" });
  doc.setFontSize(15);
  doc.text("RELATÓRIO DIÁRIO DE OBRAS", M + 22, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("AB5 · RDO", M + 22, 21);
  doc.text(formatDateBR(rdo.report_date), W - M, 15, { align: "right" });
  doc.text(RDO_STATUS_LABEL[rdo.status] ?? rdo.status, W - M, 21, { align: "right" });
  doc.setTextColor(...DARK);
  y = 40;

  const work = rdo.works as { name: string; clients: { name: string } | null } | null;
  section(1, "Identificação");
  table(
    ["Obra", "Cliente", "Data", "Responsável"],
    [60, 50, 25, 47],
    [[work?.name ?? "—", work?.clients?.name ?? "—", formatDateBR(rdo.report_date), rdo.responsible_name ?? "—"]],
  );

  section(2, "Efetivo");
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
      r.positions?.name ?? "—",
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

  section(3, "Atividades");
  para(rdo.activities ?? "");

  section(4, "Serviços");
  let any = false;
  for (const c of SERVICE_CATEGORIES) {
    const list = (services ?? []).filter((s) => s.category === c.key);
    if (!list.length) continue;
    any = true;
    ensure(8);
    doc.setFont("helvetica", "bold");
    doc.text(c.label, M, y + 1);
    y += 5;
    table(
      ["Atividade", "Local", "Qtd.", "Un.", "Produt.", "Obs."],
      [52, 34, 16, 14, 18, 48],
      list.map((s) => [s.description, s.location ?? "", s.quantity?.toString() ?? "", s.unit ?? "", s.productivity?.toString() ?? "", [s.team, s.notes].filter(Boolean).join(" · ")]),
    );
  }
  if ((scaffolds ?? []).length) {
    any = true;
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
  if (!any) para("Nenhum serviço registrado.");

  section(5, "Observações");
  para(rdo.notes ?? "");

  const photos = (media ?? []).filter((m) => m.kind === "photo");
  const videos = (media ?? []).filter((m) => m.kind === "video");
  section(6, "Registro fotográfico");
  if (!photos.length) para("Sem fotos.");
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
  if (videos.length) para(`${videos.length} vídeo(s) anexado(s) ao RDO no sistema.`);

  section(7, "Assinaturas");
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
    doc.text(`AB5 · RDO ${work?.name ?? ""} · ${formatDateBR(rdo.report_date)}`, M, 292);
    doc.text(`${i}/${pages}`, W - M, 292, { align: "right" });
  }
  doc.save(`RDO_${(work?.name ?? "obra").replace(/\W+/g, "_")}_${rdo.report_date}.pdf`);
}

import { describe, expect, it } from "vitest";
import { buildDigest, deadlineLevel, DEFAULT_PREFS, normalizeWhatsApp, todayBrasilia, validateDeadlineSettings, validatePrefs, type DigestRow } from "./notifications";

describe("deadlineLevel", () => {
  const s = { advanceDays: 5, urgentDays: 2 };
  it("classifica pelos dias até o prazo", () => {
    expect(deadlineLevel(null, "2026-11-24", s)).toBeNull();
    expect(deadlineLevel("2026-12-01", "2026-11-24", s)).toBeNull(); // 7 dias
    expect(deadlineLevel("2026-11-29", "2026-11-24", s)).toBe("antecedencia"); // 5 dias
    expect(deadlineLevel("2026-11-27", "2026-11-24", s)).toBe("antecedencia"); // 3 dias
    expect(deadlineLevel("2026-11-26", "2026-11-24", s)).toBe("urgente"); // 2 dias
    expect(deadlineLevel("2026-11-24", "2026-11-24", s)).toBe("urgente"); // no limite
    expect(deadlineLevel("2026-11-23", "2026-11-24", s)).toBe("atrasado");
  });
  it("atravessa virada de mês e ano", () => {
    expect(deadlineLevel("2027-01-01", "2026-12-31", s)).toBe("urgente");
    expect(deadlineLevel("2026-12-31", "2027-01-01", s)).toBe("atrasado");
  });
  it("respeita a configuração", () => {
    expect(deadlineLevel("2026-12-04", "2026-11-24", { advanceDays: 10, urgentDays: 3 })).toBe("antecedencia");
    expect(deadlineLevel("2026-11-25", "2026-11-24", { advanceDays: 10, urgentDays: 0 })).toBe("antecedencia");
  });
});

describe("validateDeadlineSettings", () => {
  it("exige urgente < antecedência", () => {
    expect(validateDeadlineSettings({ advanceDays: 5, urgentDays: 2 })).toBeNull();
    expect(validateDeadlineSettings({ advanceDays: 2, urgentDays: 2 })).toMatch(/menor/);
    expect(validateDeadlineSettings({ advanceDays: 0, urgentDays: 0 })).toMatch(/Antecedência/);
  });
});

describe("todayBrasilia", () => {
  it("usa o fuso de Brasília (UTC-3)", () => {
    expect(todayBrasilia(new Date("2026-11-25T02:30:00Z"))).toBe("2026-11-24");
    expect(todayBrasilia(new Date("2026-11-25T03:30:00Z"))).toBe("2026-11-25");
  });
});

describe("preferências", () => {
  it("normaliza WhatsApp", () => {
    expect(normalizeWhatsApp("(19) 99376-3387")).toBe("5519993763387");
    expect(normalizeWhatsApp("+55 19 99376-3387")).toBe("5519993763387");
    expect(normalizeWhatsApp("019993763387")).toBe("5519993763387");
    expect(normalizeWhatsApp("12345")).toBeNull();
  });
  it("obriga pelo menos um canal além do app", () => {
    expect(validatePrefs({ ...DEFAULT_PREFS, email_enabled: false })).toMatch(/pelo menos um canal/);
    expect(validatePrefs(DEFAULT_PREFS)).toBeNull();
    expect(validatePrefs({ ...DEFAULT_PREFS, email_enabled: false, push_enabled: true })).toBeNull();
  });
  it("WhatsApp e resumo precisam de telefone (o do cadastro serve)", () => {
    expect(validatePrefs({ ...DEFAULT_PREFS, whatsapp_enabled: true })).toMatch(/WhatsApp/);
    expect(validatePrefs({ ...DEFAULT_PREFS, whatsapp_enabled: true }, "19993763387")).toBeNull();
    expect(validatePrefs({ ...DEFAULT_PREFS, digest_enabled: true, whatsapp_phone: "19 99376-3387" })).toBeNull();
    expect(validatePrefs({ ...DEFAULT_PREFS, digest_enabled: true, digest_days: [] }, "19993763387")).toMatch(/dia/);
    expect(validatePrefs({ ...DEFAULT_PREFS, digest_time: "25:00" })).toMatch(/Horário/);
  });
});

describe("buildDigest", () => {
  const today = "2026-11-24";
  const row = (role: DigestRow["role"], number: string, due: string | null, client = "SUZANO"): DigestRow =>
    ({ role, id: number, number, due_date: due, status: "SOLICITAÇÃO RECEBIDA", client_name: client });
  it("não envia vazio", () => {
    expect(buildDigest([], today)).toBeNull();
  });
  it("organiza por responsabilidade e resume prazos", () => {
    const txt = buildDigest([
      row("comprador", "SC-B-002", "2026-12-31"),
      row("comprador", "SC-A-001", "2026-11-20"),
      row("validador", "SC-C-003", "2026-11-24", "MARS MM"),
      row("solicitante", "SC-D-004", null),
      row("comprador", "SC-A-001", "2026-11-20"), // repetida
    ], today, { name: "Vitória Brasilino" })!;
    expect(txt).toContain("Olá, Vitória!");
    expect(txt).toContain("*Devolvidas para você corrigir (1)*\n• SC-D-004 · SUZANO · sem prazo");
    expect(txt).toContain("*Aguardando sua validação (1)*\n• SC-C-003 · MARS MM · vence hoje");
    expect(txt).toContain("*Aguardando compra (2)*\n• SC-A-001 · SUZANO · ATRASADA (20/11)\n• SC-B-002 · SUZANO · prazo 31/12");
    expect(txt).toContain("Atrasadas (1): SC-A-001");
    expect(txt).toContain("Próximas do vencimento (1): SC-C-003");
    expect(txt.indexOf("Devolvidas")).toBeLessThan(txt.indexOf("validação"));
  });
  it("corta listas longas", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row("comprador", `SC-X-${String(i).padStart(3, "0")}`, "2026-12-31"));
    const txt = buildDigest(rows, today)!;
    expect(txt).toContain("… e mais 3");
    expect(txt).not.toContain("Atrasadas");
  });
});

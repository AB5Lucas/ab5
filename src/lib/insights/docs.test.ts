import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { blockedPeople, clientReadiness, currentDocs, daysBetween, expiryRadar, formingClasses, urgencyTone } from "./docs";
import { requirementsFrom, type ScheduleContext } from "@/lib/scheduling";

const TODAY = "2026-11-24";

function ctxOf(opts: {
  people: { id: string; full_name: string }[];
  works: { id: string; name: string; client_id: string; clientName: string; requires_integration?: boolean }[];
  asos?: { collaborator_id: string; exam_date: string; expires_at: string }[];
  integrations?: { collaborator_id: string; client_id: string; integration_date: string; expires_at: string | null }[];
  trainings?: { collaborator_id: string; training_id: string; expires_at: string | null }[];
  required?: Record<string, string[]>;
}): ScheduleContext {
  const works = opts.works.map((w) => ({
    id: w.id, name: w.name, client_id: w.client_id, entry_time: null, exit_time: null, exit_time_weekend: null, status: null, active: true,
    clients: { name: w.clientName, city: null, distance_km: null, requires_integration: w.requires_integration ?? true, needs_transport_voucher: null },
  }));
  const people = opts.people.map((p) => ({ ...p, registration_number: "", position_id: null, status: "active", is_driver: false, driver_license_category: null, driver_license_expiry: null, contract_type: null }));
  const trainingName = new Map([["nr35", "NR-35"]]);
  const requirements = requirementsFrom(works, new Map(Object.entries(opts.required ?? {})), trainingName);
  const group = <T,>(list: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return m; };
  const integrations = opts.integrations ?? [];
  return {
    works, collaborators: people, inactiveCollaborators: [], positions: [], vehicles: [], baseTeams: [], requirements,
    requiredTrainings: new Map(), trainings: [{ id: "nr35", name: "NR-35", validity_months: 24 }], collabTrainings: opts.trainings ?? [],
    absences: new Map(), holiday: null, integrations, asos: opts.asos ?? [], conferenceAccepted: new Set(), conferencePending: new Set(),
    worksById: new Map(works.map((w) => [w.id, w])), activeById: new Map(people.map((p) => [p.id, p])),
    trainingById: new Map([["nr35", { id: "nr35", name: "NR-35", validity_months: 24 }]]), positionById: new Map(),
    asosBy: group(opts.asos ?? [], (a) => a.collaborator_id),
    integrationBy: new Map(integrations.map((i) => [`${i.collaborator_id}|${i.client_id}`, i])),
    collabTrainingsBy: group(opts.trainings ?? [], (t) => t.collaborator_id),
    requirementsByWork: group(requirements, (r) => r.work_id),
  } as unknown as ScheduleContext;
}

describe("radar de vencimentos", () => {
  it("usa o documento mais recente e agrupa por dia com urgência", () => {
    const docs = currentDocs({
      people: new Map([["a", "Ana"], ["b", "Bruno"]]),
      asos: [
        { collaborator_id: "a", expires_at: "2026-11-26" },
        { collaborator_id: "a", expires_at: "2027-11-26" }, // renovado: sai do radar
        { collaborator_id: "b", expires_at: "2026-11-26" },
        { collaborator_id: "x", expires_at: "2026-11-26" }, // inativo
      ],
      trainings: [{ collaborator_id: "b", training_id: "nr35", expires_at: "2026-12-20" }, { collaborator_id: "a", training_id: "nr35", expires_at: null }],
      integrations: [{ collaborator_id: "a", client_id: "c1", expires_at: "2026-11-01" }],
      trainingName: new Map([["nr35", "NR-35"]]),
      clientName: new Map([["c1", "Suzano"]]),
    });
    const r = expiryRadar(docs, TODAY, 60);
    expect(r.days).toHaveLength(60);
    expect(r.total).toBe(2);
    expect(r.week).toBe(1);
    expect(r.expired).toBe(1);
    const d = r.days.find((x) => x.date === "2026-11-26")!;
    expect(d.count).toBe(1);
    expect(d.docs[0]!.name).toBe("Bruno");
    expect(d.tone).toBe("red");
    expect(r.days.find((x) => x.date === "2026-12-20")!.docs[0]!.label).toBe("NR-35");
  });
  it("urgência e dias", () => {
    expect(urgencyTone(0)).toBe("red");
    expect(urgencyTone(8)).toBe("orange");
    expect(urgencyTone(31)).toBe("green");
    expect(daysBetween("2026-11-24", "2026-12-02")).toBe(8);
  });
});

describe("turmas se formando", () => {
  it("agrupa por treinamento e dia futuro, pessoa uma vez", () => {
    const g = formingClasses([
      { training_id: "nr35", scheduled_date: "2026-12-02", collaborator_id: "a" },
      { training_id: "nr35", scheduled_date: "2026-12-02", collaborator_id: "a" },
      { training_id: "nr35", scheduled_date: "2026-12-02", collaborator_id: "b" },
      { training_id: "nr35", scheduled_date: "2026-11-20", collaborator_id: "c" },
      { training_id: "nr35", scheduled_date: "2026-12-03", collaborator_id: "c" },
    ], TODAY, new Map([["nr35", "NR-35"]]));
    expect(g).toEqual([{ trainingId: "nr35", date: "2026-12-02", label: "NR-35", count: 2 }]);
  });
});

describe("bloqueados e prontidão", () => {
  const ctx = ctxOf({
    people: [{ id: "a", full_name: "Ana" }, { id: "b", full_name: "Bruno" }, { id: "c", full_name: "Caio" }],
    works: [{ id: "w1", name: "Manutenção", client_id: "c1", clientName: "SUZANO" }, { id: "w2", name: "Pátio", client_id: "c2", clientName: "PATIO", requires_integration: false }],
    asos: [
      { collaborator_id: "a", exam_date: "2026-01-01", expires_at: "2026-12-31" },
      { collaborator_id: "b", exam_date: "2025-01-01", expires_at: "2025-12-31" },
      { collaborator_id: "c", exam_date: "2026-01-01", expires_at: "2026-12-31" },
    ],
    integrations: [
      { collaborator_id: "a", client_id: "c1", integration_date: "2026-01-01", expires_at: "2026-12-31" },
      { collaborator_id: "b", client_id: "c1", integration_date: "2026-01-01", expires_at: "2026-12-31" },
      { collaborator_id: "c", client_id: "c1", integration_date: "2026-01-01", expires_at: "2026-12-31" },
    ],
    trainings: [{ collaborator_id: "a", training_id: "nr35", expires_at: "2027-01-01" }, { collaborator_id: "c", training_id: "nr35", expires_at: "2026-11-01" }],
    required: { c1: ["nr35"] },
  });
  it("lista quem está escalado com documento vencido", () => {
    const b = blockedPeople(ctx, [
      { collaborator_id: "a", work_id: "w1" },
      { collaborator_id: "b", work_id: "w1" },
      { collaborator_id: "c", work_id: "w1" },
      { collaborator_id: "b", work_id: "w2" }, // Pátio: ASO não bloqueia
    ], "2026-11-25");
    expect(b.map((x) => x.name)).toEqual(["Bruno", "Caio"]);
    expect(b[0]!.reasons).toContain("Sem NR-35");
    expect(b[0]!.reasons.some((r) => r.startsWith("ASO vencido"))).toBe(true);
    expect(b[1]!.reasons[0]).toMatch(/NR-35 vencida em 01\/11\/2026/);
  });
  it("prontidão = liberados ÷ equipe do cliente", () => {
    const r = clientReadiness(ctx, [
      { collaborator_id: "a", work_id: "w1" }, { collaborator_id: "b", work_id: "w1" }, { collaborator_id: "c", work_id: "w1" }, { collaborator_id: "a", work_id: "w1" },
      { collaborator_id: "b", work_id: "w2" },
    ], TODAY);
    const suz = r.find((x) => x.clientId === "c1")!;
    expect(suz.team).toBe(3);
    expect(suz.released).toBe(1);
    expect(suz.pending).toEqual(["Bruno", "Caio"]);
    expect(r[0]!.clientId).toBe("c1"); // menor % primeiro
    expect(r.find((x) => x.clientId === "c2")!.pct).toBe(1);
  });
});

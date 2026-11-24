import { describe, expect, it } from "vitest";
import { cnhCovers, demandAlerts, driverMessage, loadSummary, overlapCounts, rodizio, suggestVehicles, timeSpan, type LogDemand, type LogRestriction } from "./logistics";

const rules: LogRestriction[] = [1, 2, 3, 4, 5].map((d, i) => ({ city: "São Paulo", weekday: d, plate_endings: ["1,2", "3,4", "5,6", "7,8", "9,0"][i]!, windows: "07:00-10:00,17:00-20:00" }));
const items = [{ description: "Tubo 6 m", qty: 300, unit_weight_kg: 23, length_m: 6, unit_volume_m3: 0.01 }, { description: "Braçadeira", qty: 400, unit_weight_kg: 1.1, length_m: 0.2, unit_volume_m3: 0.001 }];
const toco = { id: "t", plate: "ABC1D24", model: "Toco", type: "Caminhão", status: "active", cargo_capacity_kg: 8000, bed_length_m: 7, cargo_volume_m3: null, cnh_category: "C" };
const tres = { id: "q", plate: "XYZ9A11", model: "3/4", type: "Caminhão", status: "active", cargo_capacity_kg: 4000, bed_length_m: 5.2, cargo_volume_m3: null, cnh_category: "C" };
const dem: LogDemand = { id: "d", kind: "entregar", title: "Andaime", status: "programada", due_date: null, scheduled_date: "2026-11-24", departure_time: "08:00", vehicle_id: "t", driver_id: "m", trips: 1, origin_id: null, dest_id: null, contact: null, notes: null, message_sent_at: null };

describe("logística", () => {
  it("soma a carga e sugere o veículo que cabe", () => {
    const load = loadSummary(items);
    expect(Math.round(load.weight)).toBe(7340);
    expect(load.maxLength).toBe(6);
    const s = suggestVehicles(load, [tres, toco]);
    expect(s[0]!.vehicle.id).toBe("t");
    expect(s[0]!.trips).toBe(1);
    expect(s.find((x) => x.vehicle.id === "q")!.fits).toBe(false);
  });
  it("rodízio de SP pelo final da placa e dia (terça = 3 e 4)", () => {
    expect(rodizio("ABC1D24", "2026-11-24", ["Sao Paulo"], rules)?.weekday).toBe(2);
    expect(rodizio("ABC1D25", "2026-11-24", ["São Paulo"], rules)).toBeNull();
    expect(rodizio("ABC1D24", "2026-11-24", ["Limeira"], rules)).toBeNull();
  });
  it("CNH: E cobre C; B não cobre C", () => {
    expect(cnhCovers("AE", "C")).toBe(true);
    expect(cnhCovers("AB", "C")).toBe(false);
  });
  it("alertas: rodízio no horário vira vermelho; peso acima da capacidade", () => {
    const dest = { id: "a", name: "Cliente SP", street: null, city: "São Paulo", uf: "SP", receive_from: "07:00", receive_to: "10:00", needs_booking: true, notes: null };
    const a = demandAlerts(dem, { today: "2026-11-19", now: new Date("2026-11-19T12:00:00Z"), items, vehicle: toco, dest, rules, transportBusy: true });
    expect(a.some((x) => x.tone === "red" && x.text.startsWith("Rodízio"))).toBe(true);
    expect(a.some((x) => x.text.startsWith("Conflito"))).toBe(true);
    const b = demandAlerts({ ...dem, vehicle_id: "q" }, { today: "2026-11-19", now: new Date(), items, vehicle: tres, rules });
    expect(b.filter((x) => x.tone === "red").length).toBe(2);
    expect(driverMessage(dem, { items, vehicle: toco, dest, rules })).toContain("Rodízio em São Paulo");
  });
  it("Transporte: veículo em manutenção/revisão = vermelho; motorista escalado na Transporte = laranja", () => {
    const driver = { id: "m", full_name: "Motorista", driver_license_category: "D", driver_license_expiry: "2030-01-01" };
    const a = demandAlerts(dem, { today: "2026-11-19", now: new Date("2026-11-19T12:00:00Z"), items: [], vehicle: toco, driver, rules: [], transportBusy: true, transportMaintenance: true, transportDriverBusy: true });
    expect(a.find((x) => x.text.includes("manutenção/revisão"))?.tone).toBe("red");
    expect(a.some((x) => x.text === "Conflito: veículo também escalado na Transporte neste dia")).toBe(false);
    expect(a.find((x) => x.text.includes("motorista também"))?.tone).toBe("orange");
  });
});

describe("logística · agenda", () => {
  it("sobreposição de horário no mesmo veículo e no mesmo local", () => {
    const a: LogDemand = { ...dem, id: "a", departure_time: "08:00", end_time: "10:00", dest_id: "p" };
    const b: LogDemand = { ...dem, id: "b", departure_time: "09:30", end_time: null, dest_id: "p" };
    const c: LogDemand = { ...dem, id: "c", departure_time: "10:00", end_time: "11:00", vehicle_id: "x", carrier: "cliente", dest_id: "p" };
    const o = overlapCounts([a, b, c]);
    expect(o.get("a")).toEqual({ vehicle: 1, place: 1 });
    expect(o.get("c")).toEqual({ vehicle: 0, place: 1 });
    expect(timeSpan(b)).toEqual({ start: 570, end: 630 });
  });
  it("cliente que vem: sem alertas de veículo, rodízio pela placa digitada", () => {
    const d: LogDemand = { ...dem, carrier: "cliente", carrier_plate: "QWE1R24", vehicle_id: null };
    const dest = { id: "a", name: "SP", street: null, city: "São Paulo", uf: "SP", receive_from: null, receive_to: null, needs_booking: false, notes: null };
    const a = demandAlerts(d, { today: "2026-11-19", now: new Date("2026-11-19T12:00:00Z"), items, vehicle: tres, dest, rules });
    expect(a.map((x) => x.text).join()).not.toContain("capacidade");
    expect(a.some((x) => x.tone === "red" && x.text.startsWith("Rodízio"))).toBe(true);
  });
});

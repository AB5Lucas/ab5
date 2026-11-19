import { describe, expect, it } from "vitest";
import { cnhCovers, demandAlerts, driverMessage, loadSummary, rodizio, suggestVehicles, type LogDemand, type LogRestriction } from "./logistics";

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
});

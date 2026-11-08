import { describe, expect, it } from "vitest";
import { appointmentTimesConflict } from "./appointment-conflicts";

describe("horários de agendamentos", () => {
  it("permite ASO de manhã e integração à tarde no mesmo dia", () => {
    expect(appointmentTimesConflict("07:00:00", "14:00")).toBe(false);
  });
  it("impede dois agendamentos no mesmo horário", () => {
    expect(appointmentTimesConflict("14:00:00", "14:00")).toBe(true);
  });
  it("mantém conflito de dia inteiro para ausências", () => {
    expect(appointmentTimesConflict("07:00:00")).toBe(true);
  });
  it("não ignora agendamento existente sem horário", () => {
    expect(appointmentTimesConflict(null, "14:00")).toBe(true);
  });
});
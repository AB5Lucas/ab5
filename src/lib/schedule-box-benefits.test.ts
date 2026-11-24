import { describe, expect, it } from "vitest";
import { nextBoxTravel, resolveBoxTravel } from "./schedule-box-benefits";

describe("benefícios da caixa personalizada", () => {
  it("funcionário herda o prêmio da caixa sem exceção individual", () => {
    expect(resolveBoxTravel({ pays_bonus: true, overnight: false }, { pays_bonus: null, overnight: null }))
      .toEqual({ pays_bonus: true, overnight: false });
  });
  it("exceção individual desligada prevalece sobre o prêmio da caixa", () => {
    expect(resolveBoxTravel({ pays_bonus: true, overnight: true }, { pays_bonus: false, overnight: false }))
      .toEqual({ pays_bonus: false, overnight: false });
  });
  it("alterna desligado, viagem, pernoite e desligado", () => {
    const trip = nextBoxTravel({ pays_bonus: false, overnight: false });
    expect(trip).toEqual({ pays_bonus: true, overnight: false });
    const overnight = nextBoxTravel(trip);
    expect(overnight).toEqual({ pays_bonus: true, overnight: true });
    expect(nextBoxTravel(overnight)).toEqual({ pays_bonus: false, overnight: false });
  });
});
import { integrationTravelOn } from "./schedule-box-benefits";
describe("integrationTravelOn", () => {
  const hit = (km: number) => km >= 50;
  it("padrão pela distância do cliente; marcação da pessoa vale", () => {
    expect(integrationTravelOn(null, 60, hit)).toBe(true);
    expect(integrationTravelOn(undefined, 30, hit)).toBe(false);
    expect(integrationTravelOn(false, 120, hit)).toBe(false);
    expect(integrationTravelOn(true, 10, hit)).toBe(true);
  });
});

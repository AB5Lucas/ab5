import { describe, expect, it } from "vitest";
import { formatLike, parseFormatted } from "./count-up";

describe("CountUp", () => {
  it("anima só o número e mantém o formato", () => {
    const p = parseFormatted("R$ 12.345,67")!;
    expect(p.value).toBe(12345.67);
    expect(formatLike(p, 0)).toBe("R$ 0,00");
    expect(formatLike(p, 1234.5)).toBe("R$ 1.234,50");
    expect(formatLike(parseFormatted("87%")!, 40)).toBe("40%");
    expect(formatLike(parseFormatted("1.234 km")!, 12)).toBe("12 km");
    expect(parseFormatted("—")).toBeNull();
  });
});

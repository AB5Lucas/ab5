import { describe, expect, it } from "vitest";
import { cityHolidayDate, cityHolidaysOn, easterDate, holidaysForClient } from "./holidays";

describe("feriados", () => {
  it("Páscoa e Corpus Christi", () => {
    expect(easterDate(2024)).toBe("2024-03-31");
    expect(easterDate(2026)).toBe("2026-04-05");
    expect(cityHolidayDate({ city: "Mogi Mirim", month: null, day: null, easter_offset: 60, name: "Corpus Christi", auto: false, from_year: null }, 2026)).toBe("2026-06-04");
  });
  it("feriado da cidade só a partir do ano e sem acento no nome da cidade", () => {
    const cat = [{ city: "Mogi Mirim", month: 8, day: 10, easter_offset: null, name: "Dia do Evangélico", auto: false, from_year: 2027 }];
    expect(cityHolidaysOn(cat, "MOGI MIRIM", "2026-08-10")).toHaveLength(0);
    expect(cityHolidaysOn(cat, "mogi mirim", "2027-08-10")).toHaveLength(1);
  });
  it("exceções do cliente", () => {
    const rows = [{ client_id: "c", date: "2026-11-20", is_holiday: false, name: null }, { client_id: "c", date: "2026-11-23", is_holiday: true, name: null }];
    expect(holidaysForClient(["2026-11-20"], "c", rows).sort()).toEqual(["2026-11-23"]);
    expect(holidaysForClient(["2026-11-20"], "x", rows)).toEqual(["2026-11-20"]);
  });
});

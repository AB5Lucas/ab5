import { describe, expect, it } from "vitest";
import { invoiceFortnight, invoiceNumber, parseInvoiceTexts, pdfTexts } from "./fleet-invoices";

// Trecho como o PDF da fatura do posto (PowerPdf, texto em claro).
const PDF = `%PDF-1.2
5 0 obj
<<
/Length 999
/Filter []
>>
stream
BT
311 821.2 Td
(NÚMERO FATURA) Tj
ET
BT
316 809.2 Td
(00001105629-00) Tj
ET
BT
(16/09/2026) Tj
ET
BT
(01/10/2026) Tj
ET
BT
(17.870,29) Tj
ET
BT
(001) Tj
ET
BT
(PERÍODO FATURADO : DE 01/09/2026 À 15/09/2026) Tj
ET
BT
(3526 0909 4292 6900 0162) Tj
(5500) Tj
(2000 0452 4211 0228 8161) Tj
ET
BT
(\(09.429.269/0001-62\)) Tj
ET
endstream
endobj
`;
const bytes = Uint8Array.from(PDF, (c) => c.charCodeAt(0) & 0xff);

describe("fatura do posto (PDF)", () => {
  it("lê número, emissão, vencimento, valor, período e cupons", async () => {
    const texts = await pdfTexts(bytes);
    expect(texts).toContain("(09.429.269/0001-62)");
    const f = parseInvoiceTexts(texts)!;
    expect(f).toEqual({
      number: "1105629", issued_on: "2026-09-16", due_on: "2026-10-01", total: 17870.29,
      period_from: "2026-09-01", period_to: "2026-09-15", coupon_keys: ["35260909429269000162550020000452421102288161"],
    });
    expect(invoiceNumber(f.number)).toBe("001105629");
  });
  it("mês e quinzena da cobrança", () => {
    expect(invoiceFortnight("2026-09-01", "2026-09-16")).toEqual({ month: 9, year: 2026, fortnight: 1 });
    expect(invoiceFortnight("2026-09-16", "2026-10-01")).toEqual({ month: 9, year: 2026, fortnight: 2 });
    expect(invoiceFortnight(null, "2026-01-02")).toEqual({ month: 12, year: 2025, fortnight: 2 });
    expect(invoiceFortnight(null, "2026-01-16")).toEqual({ month: 1, year: 2026, fortnight: 1 });
    // A emissão manda: dia 1 a 5 = 2ª do mês anterior; 16 a 20 = 1ª do mesmo mês (mesmo com outro período no PDF).
    expect(invoiceFortnight("2026-01-01", "2026-02-03")).toEqual({ month: 1, year: 2026, fortnight: 2 });
    expect(invoiceFortnight("2026-02-16", "2026-03-18")).toEqual({ month: 3, year: 2026, fortnight: 1 });
    expect(invoiceFortnight("2026-03-16", "2026-04-10")).toEqual({ month: 3, year: 2026, fortnight: 2 });
  });
});

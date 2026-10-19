import { describe, expect, it } from "vitest";
import { activeFinancialEntries, documentKey, excelDate, moneyCents, parseBillingRows } from "./billing-sync";
const header = ["Data","Cliente","NFSe","Nro. Pedido","Proposta","R$ Bruto","Cancelada?"];
const row = (date: string, invoice: number, cancelled="NÃO", amount=3000.02) => [date,"Hyster",invoice,"inexistente","26/315",amount,cancelled];
describe("regras da fonte de faturamentos",()=>{
  it("inclui 01/10/2026 e ignora notas anteriores mesmo canceladas",()=>{
    const parsed=parseBillingRows([header,row("01/10/2026",1),row("30/09/2026",2,"SIM")]);
    expect(parsed.notes.map(n=>n.invoice)).toEqual(["1"]);expect(parsed.ignored).toBe(1);
  });
  it("normaliza orçamento 26/315 em ambas as direções sem misturar ano e série",()=>{
    expect(documentKey("26/315")).toBe(documentKey(" 26 / 0315 "));
    expect(documentKey("25/0315")).not.toBe(documentKey("26/315"));
    expect(documentKey("A-26/0315")).not.toBe(documentKey("B-26/315"));
  });
  it("preserva pedido inexistente e orçamento para a busca alternativa",()=>{
    const n=parseBillingRows([header,row("01/10/2026",1)]).notes[0];expect(n?.order).toBe("inexistente");expect(n?.quote).toBe("26/315");
  });
  it("calcula diferença de R$0,02 em centavos e mantém os R$3000,02 originais",()=>{
    expect(moneyCents("3.000,02")).toBe(300002);expect((moneyCents(3000.02)??0)-(moneyCents(3000)??0)).toBe(2);
    expect(parseBillingRows([header,row("01/10/2026",1)]).notes[0]?.amountCents).toBe(300002);
  });
  it("não aceita valor monetário inválido",()=>{expect(moneyCents("#REF!")).toBeNull();});
  it("não duplica nota idêntica da fonte",()=>{expect(parseBillingRows([header,row("01/10/2026",1),row("01/10/2026",1)]).notes).toHaveLength(1);});
  it("marca nota duplicada conflitante para revisão sem escolher silenciosamente",()=>{expect(parseBillingRows([header,row("01/10/2026",1),row("01/10/2026",1,"SIM")]).notes[0]?.error).toBeDefined();});
  it("identifica nota cancelada na primeira leitura",()=>{expect(parseBillingRows([header,row("01/10/2026",1,"SIM")]).notes[0]?.cancelled).toBe(true);});
  it("cancelamento não compõe faturamento financeiro ativo e não altera valor original",()=>{
    const rows=[{amount:3000,sync_cancelled:true},{amount:4000,sync_cancelled:false}];
    expect(activeFinancialEntries(rows).reduce((a,n)=>a+n.amount,0)).toBe(4000);expect(rows[0]?.amount).toBe(3000);
  });
  it("isola linha inválida e preserva próxima nota válida",()=>{const rows=parseBillingRows([header,row("31/02/2026",1),row("01/10/2026",2)]);expect(rows.invalid).toBe(1);expect(rows.notes[0]?.invoice).toBe("2");});
  it("usa data de emissão serial Excel, não mês quebrado ou data de vencimento",()=>{expect(excelDate(46296)).toBe("2026-10-01");});
});
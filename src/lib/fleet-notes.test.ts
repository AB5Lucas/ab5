import { describe, expect, it } from "vitest";
import { clientCc, folderMonthScore, fuelRateio, infoFields, maintenanceState, parseFuelXml, pickMonthFolder, sharepointPath } from "./fleet-notes";

const KEY = "35261112345678000199550010000482111000482115";
const XML = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${KEY}" versao="4.00">
<ide><nNF>48211</nNF><dhEmi>2026-11-03T08:15:00-03:00</dhEmi></ide>
<emit><xNome>AUTO POSTO X LTDA</xNome><xFant>Posto X</xFant></emit>
<det nItem="1"><prod><xProd>OLEO DIESEL B S10</xProd><uCom>L</uCom><qCom>62.4000</qCom><vUnCom>6.1900</vUnCom><vProd>386.26</vProd><comb><cProdANP>820101034</cProdANP></comb></prod></det>
<total><ICMSTot><vNF>386.26</vNF></ICMSTot></total>
<infAdic><infCpl>PLACA: TDJ-9B37 KM: 84.320 MOTORISTA: MATHEUS QUIRINO - FROTA</infCpl></infAdic>
</infNFe></NFe></nfeProc>`;

describe("XML do posto", () => {
  it("lê chave, NF, combustível, placa, km e motorista", () => {
    const r = parseFuelXml(XML, `${KEY}.xml`)!;
    expect(r.access_key).toBe(KEY);
    expect(r.nf_number).toBe("48211");
    expect(r.issuer).toBe("Posto X");
    expect(r.fuel).toBe("OLEO DIESEL B S10");
    expect(r.quantity).toBe(62.4);
    expect(r.unit_price).toBeCloseTo(6.19, 3);
    expect(r.total).toBe(386.26);
    expect(r.plate).toBe("TDJ9B37");
    expect(r.km).toBe(84320);
    expect(r.driver).toBe("Matheus Quirino");
  });
  it("placa antiga vira Mercosul e campos de observação também valem", () => {
    expect(infoFields("xCampo PLACA: FRE 2810 | HODOMETRO: 120880,5 | CONDUTOR: ANA DE SOUZA").plate).toBe("FRE2I10");
    expect(infoFields("HODOMETRO: 120880,5").km).toBe(120880.5);
    expect(infoFields("CONDUTOR: ANA DE SOUZA").driver).toBe("Ana de Souza");
  });
  it("arquivo que não é NF-e é ignorado", () => {
    expect(parseFuelXml("<evento/>", "x.xml")).toBeNull();
  });
});

describe("pastas", () => {
  it("acha a pasta do mês pelo nome", () => {
    expect(folderMonthScore("11 - NOVEMBRO", "2026-11")).toBeGreaterThan(0);
    expect(folderMonthScore("2026-11", "2026-11")).toBeGreaterThan(0);
    expect(folderMonthScore("11.2025", "2026-11")).toBe(0);
    expect(folderMonthScore("01", "2026-11")).toBe(0);
    expect(pickMonthFolder([{ name: "10 - OUTUBRO" }, { name: "11 - NOVEMBRO" }, { name: "12" }], "2026-11")?.name).toBe("11 - NOVEMBRO");
    expect(pickMonthFolder([{ name: "2026" }], "2026-02")).toBeNull();
  });
  it("converte o caminho do computador para o SharePoint", () => {
    expect(sharepointPath("C:\\Users\\x\\AB5\\servidor dados - Compras\\06 FISCAL\\POSTO\\")).toBe("Compras/06 FISCAL/POSTO");
  });
});

describe("rateio e centro de custo", () => {
  const clients = new Map([
    ["c1", { id: "c1", name: "Suzano", cc_prefix: "0102" }],
    ["c2", { id: "c2", name: "Indústria", cc_prefix: "0001" }],
  ]);
  const works = [
    { id: "w1", client_id: "c1", cc_suffix: "001", active: true },
    { id: "w2", client_id: "c1", cc_suffix: "002", active: true },
    { id: "w3", client_id: "c2", cc_suffix: "001", active: true },
  ];
  it("um serviço ativo usa o CC dele; mais de um vai para o almoxarifado", () => {
    expect(clientCc(clients.get("c2"), works).cc).toBe("0001001");
    expect(clientCc(clients.get("c1"), works).cc).toBe("0102999");
  });
  it("divide pelos dias desde o abastecimento anterior", () => {
    const schedules = [
      ...["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-03"].map((d) => ({ vehicle_id: "v1", schedule_date: d, client_id: "c1" })),
      ...["2026-11-01", "2026-11-02"].map((d) => ({ vehicle_id: "v1", schedule_date: d, client_id: "c2" })),
      { vehicle_id: "v1", schedule_date: "2026-10-27", client_id: "c2" },
    ];
    const r = fuelRateio({ vehicleId: "v1", day: "2026-11-03", prevDay: "2026-10-27", total: 386.26, schedules, clients, works, accounts: [{ cc_code: "0102", item_account: "4.1.02" }] });
    expect(r.parts.map((p) => [p.client, p.days, p.cc, p.item_account])).toEqual([["Suzano", 5, "0102999", "4.1.02"], ["Indústria", 2, "0001001", null]]);
    expect(r.parts.reduce((s, p) => s + p.value, 0)).toBeCloseTo(386.26, 2);
  });
});

describe("manutenção", () => {
  it("vence pelo km ou pelo tempo", () => {
    const plan = { interval_km: 10000, interval_months: 6, base_km: 76100, base_date: "2026-06-12" };
    expect(maintenanceState(plan, null, 84320, "2026-11-11").status).toBe("em-dia");
    expect(maintenanceState(plan, null, 85300, "2026-11-11").status).toBe("perto");
    expect(maintenanceState(plan, null, 84320, "2026-11-20").status).toBe("perto");
    expect(maintenanceState(plan, null, 86200, "2026-11-11").status).toBe("vencida");
    expect(maintenanceState(plan, { km: 84000, date: "2026-11-01" }, 84320, "2026-11-11").status).toBe("em-dia");
    expect(maintenanceState(null, null, 1000, "2026-11-11").status).toBe("sem-regra");
  });
});

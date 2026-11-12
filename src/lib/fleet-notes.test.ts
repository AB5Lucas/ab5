import { describe, expect, it } from "vitest";
import { baseFolderPath, clientCc, closestPlate, driverRanking, fixedRateio, matchDriverName, plateRuleSplit, folderMonthScore, fuelRateio, infoFields, itemAccountFor, maintenanceState, matchPhotosByTime, otherPlates, parseFuelXml, photoTime, pickMonthFolder, sharepointPath } from "./fleet-notes";

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
    const rows = parseFuelXml(XML, `${KEY}.xml`)!;
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.item_no).toBe(1);
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

describe("notas reais do posto", () => {
  const INFO = "CX:CAIXA 4 -  OP:CARLINDO V:432.  CLIENTE: AB5 INDUSTRIA E COMERCIO LTDA.  IE: 455143410113 .  PLACA: LQA-2I52 VOLKSWAGEN KOMBI     KM: 112643.  MOTORISTA: ANDRE JESUS. AV. MINISTRO ROBERTO CARDOSO ALVES 1215, PARQ INDUSTRIAL, MOGI GUACU/SP, CEP 13849-212.  MEDIA ATUAL 9,3 KM/L.";
  it("lê placa, km e motorista do texto do posto", () => {
    expect(infoFields(INFO)).toEqual({ plate: "LQA2I52", km: 112643, driver: "Andre Jesus" });
    expect(otherPlates(INFO, "LQA2I52")).toEqual([]);
    expect(otherPlates("PLACA: TDJ-9B39 ONIX KM: 53533.  MOTORISTA: ANDRE JESUS - TDE4F86 FROTA", "TDJ9B39")).toEqual(["TDE4F86"]);
  });
  it("liga a foto do WhatsApp pela hora", () => {
    expect(photoTime("WhatsApp Image 2026-11-04 at 15.16.43.jpeg")).toBe(Date.parse("2026-11-04T15:16:43-03:00"));
    const m = matchPhotosByTime(
      [{ key: "a", issued_at: "2026-11-04T15:14:00-03:00" }, { key: "b", issued_at: "2026-11-04T17:45:00-03:00" }, { key: "c", issued_at: "2026-11-01T08:00:00-03:00" }],
      ["WhatsApp Image 2026-11-04 at 15.16.43.jpeg", "WhatsApp Image 2026-11-04 at 17.51.28.jpeg"],
    );
    expect(m.get("a")).toBe("WhatsApp Image 2026-11-04 at 15.16.43.jpeg");
    expect(m.get("b")).toBe("WhatsApp Image 2026-11-04 at 17.51.28.jpeg");
    expect(m.has("c")).toBe(false);
  });
});

describe("pastas", () => {
  it("reconhece a pasta 112026 e sobe um nível quando colam a pasta do mês", () => {
    expect(pickMonthFolder([{ name: "102026" }, { name: "112026" }], "2026-11")?.name).toBe("112026");
    expect(folderMonthScore("112025", "2026-11")).toBe(0);
    expect(baseFolderPath("C:\\Users\\x\\AB5\\servidor dados - Compras\\04 COMPRAS\\04 CONSUMO VEICULAR\\02 XML\\112026")).toBe("Compras/04 COMPRAS/04 CONSUMO VEICULAR/02 XML");
  });
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
  it("mesmo CC com dois rateios: vale o nome do cliente; sem prefixo, o CC vem da tabela", () => {
    const table = [
      { cc_code: "1001999", item_account: "003", description: "INDÚSTRIA" },
      { cc_code: "1001999", item_account: "008", description: "PATIO" },
      { cc_code: "2030999", item_account: "008", description: "SUZANO" },
    ];
    expect(itemAccountFor("1001999", table, "INDUSTRIA")).toBe("003");
    expect(itemAccountFor("1001999", table, "Pátio")).toBe("008");
    expect(itemAccountFor("1001999", table, "Outro")).toBeNull();
    expect(itemAccountFor("2030999", table, "Suzano Papel")).toBe("008");
    expect(clientCc({ id: "p", name: "PATIO", cc_prefix: null }, [], table)).toEqual({ cc: "1001999", rule: "CC da tabela Item Conta (cliente sem prefixo)" });
    expect(clientCc({ id: "c", name: "COCA", cc_prefix: "2025" }, [{ id: "w", client_id: "c", cc_suffix: null, active: true }]).cc).toBe("2025999");
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

describe("ADM como Diretoria", () => {
  it("cliente cujo CC calculado não está na tabela usa a linha com o nome dele", () => {
    const clients = new Map([["a", { id: "a", name: "ADM", cc_prefix: "2000" }]]);
    const works = [{ id: "w", client_id: "a", cc_suffix: null, active: true }];
    const accounts = [
      { cc_code: "2000999", item_account: "013", description: "COMERCIAL SERVIÇOS" },
      { cc_code: "2000999", item_account: "007", description: "SERVIÇOS" },
      { cc_code: "2000", item_account: "010", description: "ADM" },
    ];
    const r = fuelRateio({ vehicleId: "v", day: "2026-11-05", prevDay: "2026-11-01", total: 100, schedules: [{ vehicle_id: "v", schedule_date: "2026-11-03", client_id: "a" }], clients, works, accounts });
    expect([r.parts[0]!.cc, r.parts[0]!.item_account]).toEqual(["2000", "010"]);
  });
});

describe("ranking de entrega de notas", () => {
  it("motorista pela Transporte, pelo nome da nota quando não há programação, e prazo de 2 dias", () => {
    const names = new Map([["m1", "Maycon Roberto Ribeiro dos Santos"], ["m2", "André Jesus de Souza"]]);
    const vehicles = new Map([["URY3B26", "v1"], ["TDE4F86", "v2"]]);
    const schedules = [{ vehicle_id: "v1", schedule_date: "2026-11-02", driver_id: "m1" }, { vehicle_id: "v1", schedule_date: "2026-11-03", driver_id: "m1" }];
    const base = { plate_fix: null, driver_fix: null, total: 100 };
    const notes = [
      { ...base, id: "a", nf_number: "1", issued_at: "2026-11-02T15:00:00-03:00", plate: "URY3B26", driver: "MAYCON", note_file: "f.jpg" },
      { ...base, id: "b", nf_number: "2", issued_at: "2026-11-04T05:00:00-03:00", plate: "URY3B26", driver: "MAYCON", note_file: null },
      { ...base, id: "c", nf_number: "3", issued_at: "2026-11-10T19:00:00-03:00", plate: "TDE4F86", driver: "Andre Jesus", note_file: null },
    ];
    const r = driverRanking(notes, schedules, vehicles, names, "2026-11-11");
    const maycon = r.find((x) => x.key === "id:m1")!;
    expect([maycon.total, maycon.delivered, maycon.pending, maycon.score]).toEqual([2, 1, 1, 50]);
    const andre = r.find((x) => x.key === "id:m2")!;
    expect([andre.source, andre.waiting, andre.pending]).toEqual(["nota", 1, 0]);
  });
});

describe("CC à mão e placa com CC fixo", () => {
  const acc = [{ cc_code: "2004221", item_account: "018", description: "ADM MARS" }, { cc_code: "2030999", item_account: "008", description: "SUZANO" }];
  it("divide o valor pelas % de cada CC, fechando os centavos no último", () => {
    const r = fixedRateio([{ cc_code: "2004221", item_account: null, label: "ADM MARS", pct: 33.33 }, { cc_code: "2030999", item_account: null, label: "SUZANO", pct: 66.67 }], 100, "2026-11-05", "CC informado à mão", acc);
    expect(r.parts.map((p) => [p.cc, p.item_account, p.value])).toEqual([["2004221", "018", 33.33], ["2030999", "008", 66.67]]);
  });
  it("DAJ5I66 vai sempre para o 2004221", () => {
    expect(plateRuleSplit("DAJ5I66", acc)).toEqual([{ cc_code: "2004221", item_account: "018", label: "ADM MARS", pct: 100 }]);
    expect(plateRuleSplit("TDJ9B39", acc)).toBeNull();
  });
});

describe("nota com dois combustíveis", () => {
  const TWO = XML.replace(/<det nItem="1">[\s\S]*?<\/det>/, `<det nItem="1"><prod><xProd>OLEO DIESEL B S10</xProd><uCom>L</uCom><qCom>50</qCom><vUnCom>6.00</vUnCom><vProd>300.00</vProd><comb><cProdANP>820101034</cProdANP></comb></prod></det>
<det nItem="2"><prod><xProd>ARLA 32</xProd><uCom>L</uCom><qCom>20</qCom><vUnCom>4.313</vUnCom><vProd>86.26</vProd><comb><cProdANP>810102001</cProdANP></comb></prod></det>`);
  it("vira duas linhas do mesmo XML, cada uma com o seu valor", () => {
    const rows = parseFuelXml(TWO, `${KEY}.xml`)!;
    expect(rows.map((r) => [r.item_no, r.fuel, r.quantity, r.total])).toEqual([[1, "OLEO DIESEL B S10", 50, 300], [2, "ARLA 32", 20, 86.26]]);
    expect(rows.every((r) => r.access_key === KEY && r.plate === "TDJ9B37")).toBe(true);
  });
});

describe("placa e motorista da nota → cadastro", () => {
  it("placa antiga vira a Mercosul cadastrada e erro de digitação acha a mais próxima", () => {
    expect(closestPlate("ECM8414", ["ECM8E14", "TDJ9B39"])).toBe("ECM8E14");
    expect(closestPlate("ECM-8E14", [], ["ECM8E14"])).toBe("ECM8E14");
    expect(closestPlate("TDJ9B3O", ["TDJ9B30", "TDJ9B39"])).toBe("TDJ9B30");
    expect(closestPlate("TDJ9B38", ["TDJ9B39"])).toBe("TDJ9B39");
    expect(closestPlate("XYZ1A23", ["TDJ9B39"])).toBe("XYZ1A23");
  });
  it("nome da nota vira o nome completo, primeiro entre os liberados", () => {
    const liberados = ["MATHEUS QUIRINO DA SILVA", "ANDRE DE JESUS SANTOS"];
    expect(matchDriverName("Matheus Quirino", liberados)).toBe("MATHEUS QUIRINO DA SILVA");
    expect(matchDriverName("Andre Jesus", liberados)).toBe("ANDRE DE JESUS SANTOS");
    expect(matchDriverName("Andre Jesu", liberados)).toBe("ANDRE DE JESUS SANTOS");
    expect(matchDriverName("Andre", liberados)).toBe("ANDRE DE JESUS SANTOS");
    expect(matchDriverName("Andre", [], ["ANDRE DE JESUS SANTOS", "ANDRE LUIZ"])).toBeNull();
    expect(matchDriverName("Carlos Souza", liberados, ["CARLOS EDUARDO SOUZA"])).toBe("CARLOS EDUARDO SOUZA");
    expect(matchDriverName("Carlos", liberados)).toBeNull();
  });
});

describe("rateio pelo km", () => {
  it("divide pelo km rodado em cada cliente no período", () => {
    const clients = new Map([["a", { id: "a", name: "Suzano", cc_prefix: "0102" }], ["b", { id: "b", name: "Mars", cc_prefix: "0200" }]]);
    const schedules = [
      { vehicle_id: "v", schedule_date: "2026-11-02", client_id: "a", km: 50, trips: 1 },
      { vehicle_id: "v", schedule_date: "2026-11-03", client_id: "a", km: 50, trips: 1 },
      { vehicle_id: "v", schedule_date: "2026-11-04", client_id: "b", km: 10, trips: 1, extra_client_ids: ["a"], extra_km: 20 },
    ];
    const r = fuelRateio({ vehicleId: "v", day: "2026-11-05", prevDay: "2026-11-01", total: 240, schedules, clients, works: [], accounts: [] });
    expect(r.basis).toBe("km");
    // Suzano: 100 + 100 + 20 extra = 220 km; Mars: 20 km.
    expect(r.parts.map((p) => [p.client, p.km, p.value])).toEqual([["Suzano", 220, 220], ["Mars", 20, 20]]);
  });
});

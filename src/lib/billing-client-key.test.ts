import { describe, expect, it } from "vitest";
import { loadEnv } from "vite";

describe("correspondência de cliente na sincronização", () => {
  it("identifica SPAL JUNDIAI como COCA na regra real de faturamentos", async () => {
    const env = loadEnv("test", process.cwd(), "");
    const url = env["VITE_SUPABASE_URL"];
    const key = env["VITE_SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) throw new Error("Configuração para o teste não encontrada");
    const normalize = async (v: string) => {
      const response = await fetch(`${url}/rest/v1/rpc/billing_client_key`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ v }),
      });
      if (!response.ok) throw new Error(`Falha na consulta da regra: ${response.status}`);
      return response.json();
    };
    expect(await normalize("SPAL JUNDIAI")).toBe("COCA");
    expect(await normalize(" spal jundiaí ")).toBe("COCA");
    expect(await normalize("COCA")).toBe("COCA");
    expect(await normalize("SPAL OUTRA UNIDADE")).toBe("SPALOUTRAUNIDADE");
  });
});
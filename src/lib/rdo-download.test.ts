import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { prepareRdoDownload } from "./rdo-download";

const generate = async (id: string) => ({
  blob: new Blob([`%PDF-1.4 ${id}`], { type: "application/pdf" }),
  filename: "RDO.pdf",
});

describe("filtered RDO download", () => {
  it("one filtered RDO downloads as PDF", async () => {
    const file = await prepareRdoDownload(["one"], generate);
    expect(file.filename).toBe("RDO.pdf");
    expect(file.blob.type).toBe("application/pdf");
    expect(await file.blob.text()).toBe("%PDF-1.4 one");
  });
  it("multiple filtered RDOs download as ZIP without overwriting equal names", async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const file = await prepareRdoDownload(["filtered-a", "filtered-b"], async (id) => {
      calls.push(id);
      return generate(id);
    }, (done) => progress.push(done));
    const zip = await JSZip.loadAsync(await file.blob.arrayBuffer());
    expect(file.filename.endsWith(".zip")).toBe(true);
    expect(Object.keys(zip.files)).toEqual(["001-RDO.pdf", "002-RDO.pdf"]);
    expect(await zip.file("002-RDO.pdf")?.async("string")).toBe("%PDF-1.4 filtered-b");
    expect(calls).toEqual(["filtered-a", "filtered-b"]);
    expect(progress).toEqual([1, 2]);
  });
  it("zero filtered RDOs cannot produce a download", async () => {
    await expect(prepareRdoDownload([], generate)).rejects.toThrow("Nenhum RDO encontrado.");
  });
  it("a PDF failure aborts the entire download instead of shipping a partial ZIP", async () => {
    await expect(prepareRdoDownload(["a", "b"], async () => { throw new Error("Sem acesso"); })).rejects.toThrow("Sem acesso");
  });
});
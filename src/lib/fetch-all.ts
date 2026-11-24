const PAGE = 1000;
const PARALLEL_PAGES = 8;
/** Lê todas as páginas. Depois da primeira página cheia, busca as seguintes em grupos paralelos
 * e junta na ordem das páginas — mesmo resultado da leitura sequencial, com menos esperas.
 * A consulta precisa de ORDER BY numa coluna única (ex.: `.order("id")`): a paginação é por
 * OFFSET e, sem ordem estável, páginas diferentes podem repetir ou perder linhas. */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const page = async (n: number) => {
    const { data, error } = await build(n * PAGE, n * PAGE + PAGE - 1);
    if (error) throw error;
    return data ?? [];
  };
  const out: T[] = [...(await page(0))];
  if (out.length < PAGE) return out;
  for (let next = 1; ; next += PARALLEL_PAGES) {
    const pages = await Promise.all(Array.from({ length: PARALLEL_PAGES }, (_, i) => page(next + i)));
    for (const rows of pages) {
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
}

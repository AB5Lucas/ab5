/** Datas ISO (AAAA-MM-DD) dos blocos vivos, sem fuso: meio-dia UTC evita virar o dia. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86400000);

export const addDaysIso = (d: string, n: number) => {
  const x = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** dd/mm */
export const shortBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

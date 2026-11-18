/**
 * Alojamentos (botão Alojamentos na Programação; tabela lodging_stays com entrada e saída).
 * - Americana: na Suzano, sem VT e sem prêmio viagem; nas outras obras (e na Indústria) o prêmio viagem é pela
 *   distância de Americana até a obra.
 * - Mogi Guaçu: tratado como morador de Mogi Guaçu (VT e prêmio viagem pela distância de Mogi Guaçu).
 * A cidade do cadastro não muda: a regra vale só nos dias em que a pessoa está alojada.
 */
export type Lodging = "americana" | "mogi_guacu";
export type LodgingStay = { collaborator_id: string; lodging: Lodging | string; start_date: string; end_date: string | null };

export const LODGING_LABEL: Record<Lodging, string> = { americana: "Americana", mogi_guacu: "Mogi Guaçu" };
export const LODGING_TAG: Record<Lodging, string> = { americana: "AMR", mogi_guacu: "MGG" };
const LODGING_CITY: Record<Lodging, string> = { americana: "Americana", mogi_guacu: "Mogi Guaçu" };

const plain = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
export const isSuzanoClient = (name: string | null | undefined) => /\bSUZANO\b/.test(plain(name));

/** Alojamento da pessoa no dia (o mais recente que cobre a data). */
export function lodgingOn(stays: LodgingStay[], collaboratorId: string, date: string): Lodging | null {
  let best: LodgingStay | null = null;
  for (const s of stays) {
    if (s.collaborator_id !== collaboratorId || s.start_date > date || (s.end_date && s.end_date < date)) continue;
    if (!best || s.start_date > best.start_date) best = s;
  }
  return (best?.lodging as Lodging | undefined) ?? null;
}

/** Índice por pessoa para consultas rápidas em listas grandes. */
export function lodgingIndex(stays: LodgingStay[]) {
  const by = new Map<string, LodgingStay[]>();
  for (const s of stays) by.set(s.collaborator_id, [...(by.get(s.collaborator_id) ?? []), s]);
  return (collaboratorId: string, date: string) => lodgingOn(by.get(collaboratorId) ?? [], collaboratorId, date);
}

/** Cidade que vale para VT e prêmio viagem: a do alojamento, se estiver alojado; senão a do cadastro. */
export const effectiveCity = (city: string | null | undefined, lodging: Lodging | null) => (lodging ? LODGING_CITY[lodging] : city ?? null);

/** Montador (cargo com "Montador") alojado em Mogi Guaçu: nunca recebe VT, em nenhuma obra. */
export const isMontador = (position: string | null | undefined) => /MONTADOR/.test(plain(position));
export const lodgingBlocksVtAlways = (lodging: Lodging | null, position: string | null | undefined) => lodging === "mogi_guacu" && isMontador(position);

/** Alojado em Americana trabalhando na Suzano: sem VT e sem prêmio viagem. */
export const lodgingBlocksBenefits = (lodging: Lodging | null, clientName: string | null | undefined) =>
  lodging === "americana" && isSuzanoClient(clientName);

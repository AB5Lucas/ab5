export type BoxTravel = { pays_bonus: boolean; overnight: boolean };

export function nextBoxTravel(current: BoxTravel): BoxTravel {
  if (current.overnight) return { pays_bonus: false, overnight: false };
  if (current.pays_bonus) return { pays_bonus: true, overnight: true };
  return { pays_bonus: true, overnight: false };
}

export function resolveBoxTravel(
  box: BoxTravel,
  person?: { pays_bonus: boolean | null; overnight: boolean | null },
): BoxTravel {
  return {
    pays_bonus: person?.pays_bonus ?? box.pays_bonus,
    overnight: person?.overnight ?? box.overnight,
  };
}
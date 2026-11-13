/**
 * Avisos da Programação (botão Avisos ao lado de Folgas e "!" no menu para o próximo dia útil).
 * Vermelho = alto impacto; laranja = pequeno impacto. Regras escolhidas pelo usuário:
 * V1 treinamento sem TST no ADM · V8 veículo sem motorista / CNH vencida · V9 cliente sem transporte ·
 * V10 descanso < 11h entre jornadas · V11 programação do próximo dia útil não criada após o horário de corte ·
 * L1 documentos vencendo em 7 dias · L2 agendamento sem confirmação na plataforma · L5 pessoas sem escalação (sem intermitentes e PJ).
 * (L4, manutenção de veículo, aguarda a aba Manutenção estar alimentada.)
 */
export type AlertTone = "red" | "orange";
export type ScheduleAlert = { key: string; tone: AlertTone; title: string; people: string[] };

const plain = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
export const addDaysIso = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
export const isTst = (position: string | null | undefined) => /SEGURANCA DO TRABALHO/.test(plain(position));

/** Próximo dia útil depois de `today` (pula sábado, domingo e feriados). */
export function nextBusinessDay(today: string, holidays: ReadonlySet<string>): string {
  let d = addDaysIso(today, 1);
  for (let i = 0; i < 30 && ([0, 6].includes(weekday(d)) || holidays.has(d)); i++) d = addDaysIso(d, 1);
  return d;
}

/** Horário de corte do aviso "programação não criada": seg–qui 16h; sex, sáb e dom 15h (horário de Brasília). */
export function pastCutoff(now: Date): boolean {
  const br = new Date(now.getTime() - 3 * 3600_000);
  const dow = br.getUTCDay();
  const cut = dow >= 1 && dow <= 4 ? 16 : 15;
  return br.getUTCHours() >= cut;
}

const minutes = (t: string | null | undefined) => { const m = (t ?? "").match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export type AlertWork = { id: string; name: string; client_id: string | null; entry_time: string | null; exit_time: string | null; exit_time_weekend: string | null; night_shift: boolean | null };
export type AlertData = {
  date: string;
  today: string;
  now: Date;
  holidays: Set<string>;
  scheduleExists: boolean;
  /** Pessoas escaladas no dia e no dia anterior (data corrida). */
  allocations: { collaborator_id: string; work_id: string }[];
  prevAllocations: { collaborator_id: string; work_id: string }[];
  works: Map<string, AlertWork>;
  clients: Map<string, { name: string; needs_company_transport: boolean | null }>;
  people: Map<string, { name: string; position: string | null; cnh: string | null; active: boolean; contract?: string | null }>;
  vehicles: { plate: string; driver_id: string | null; extra_driver_ids: string[]; client_id: string | null; extra_client_ids: string[]; is_maintenance: boolean; is_external: boolean }[];
  appointments: { collaborator_id: string; type: string; status: string; client_booked: boolean; label: string }[];
  /** Agendamentos futuros (ASO/treinamento/integração) que já cobrem um vencimento: tipo|pessoa|treino-ou-cliente. */
  covered: Set<string>;
  asos: { collaborator_id: string; expires_at: string | null }[];
  integrations: { collaborator_id: string; client_id: string; expires_at: string | null; documentation: boolean | null }[];
  trainings: { collaborator_id: string; training_id: string; name: string; expires_at: string | null }[];
  /** Quem está fora do dia por quadro (falta, folga...), férias, folga, atestado ou agendamento. */
  accounted: Set<string>;
  /** Quem trabalhou nos 14 dias anteriores. */
  recent: Set<string>;
};

const br = (d: string) => d.split("-").reverse().join("/");

export function scheduleAlerts(d: AlertData): ScheduleAlert[] {
  const out: ScheduleAlert[] = [];
  const name = (id: string) => d.people.get(id)?.name ?? "—";
  const clientOf = (workId: string) => d.works.get(workId)?.client_id ?? null;
  const businessDay = ![0, 6].includes(weekday(d.date)) && !d.holidays.has(d.date);

  // V11: programação do próximo dia útil não criada (ou sem ninguém) depois do horário de corte.
  if (d.date === nextBusinessDay(d.today, d.holidays) && pastCutoff(d.now) && (!d.scheduleExists || !d.allocations.length)) {
    out.push({ key: "v11", tone: "red", title: `Programação de ${br(d.date)} ainda não foi criada`, people: [] });
  }

  // V1: treinamento agendado no dia sem TST escalado no ADM.
  const trainingsToday = d.appointments.filter((a) => a.type === "treinamento" && a.status !== "cancelado");
  if (trainingsToday.length) {
    const tstInAdm = d.allocations.some((a) => {
      const c = clientOf(a.work_id);
      return c && plain(d.clients.get(c)?.name) === "ADM" && isTst(d.people.get(a.collaborator_id)?.position);
    });
    if (!tstInAdm) out.push({ key: "v1", tone: "red", title: `${trainingsToday.length} treinamento(s) agendado(s) e nenhum TST escalado no ADM`, people: trainingsToday.map((a) => `${name(a.collaborator_id)} · ${a.label}`) });
  }

  // V8: veículo sem motorista ou motorista com CNH vencida.
  const noDriver = d.vehicles.filter((v) => !v.is_maintenance && !v.is_external && !v.driver_id && !v.extra_driver_ids.length).map((v) => v.plate);
  if (noDriver.length) out.push({ key: "v8a", tone: "red", title: `${noDriver.length} veículo(s) na Transporte sem motorista`, people: noDriver });
  const badCnh = [...new Set(d.vehicles.filter((v) => !v.is_maintenance).flatMap((v) => [v.driver_id, ...v.extra_driver_ids]).filter((x): x is string => !!x))]
    .filter((id) => { const c = d.people.get(id)?.cnh; return !!c && c < d.date; });
  if (badCnh.length) out.push({ key: "v8b", tone: "red", title: `${badCnh.length} motorista(s) com CNH vencida`, people: badCnh.map((id) => `${name(id)} · venceu em ${br(d.people.get(id)!.cnh!)}`) });

  // V9: cliente que usa transporte da empresa, com equipe escalada e sem veículo montado.
  const served = new Set(d.vehicles.filter((v) => !v.is_maintenance).flatMap((v) => [v.client_id, ...v.extra_client_ids]).filter(Boolean));
  const teamClients = [...new Set(d.allocations.map((a) => clientOf(a.work_id)).filter((x): x is string => !!x))];
  const noTransport = teamClients.filter((c) => d.clients.get(c)?.needs_company_transport && !served.has(c)).map((c) => d.clients.get(c)!.name).sort();
  if (noTransport.length) out.push({ key: "v9", tone: "red", title: `${noTransport.length} cliente(s) com equipe e sem transporte montado`, people: noTransport });

  // V10: descanso menor que 11h entre a saída do dia anterior e a entrada do dia.
  const prevWeekend = [0, 6].includes(weekday(addDaysIso(d.date, -1)));
  const shortRest: string[] = [];
  for (const a of d.allocations) {
    const w = d.works.get(a.work_id);
    const entry = minutes(w?.entry_time);
    if (entry == null) continue;
    for (const p of d.prevAllocations.filter((x) => x.collaborator_id === a.collaborator_id)) {
      const pw = d.works.get(p.work_id);
      const pin = minutes(pw?.entry_time);
      const pout = minutes(prevWeekend && pw?.exit_time_weekend ? pw.exit_time_weekend : pw?.exit_time);
      if (pin == null || pout == null) continue;
      // Saída no próprio dia anterior, ou no dia (turno noturno / saída antes da entrada).
      const exitAbs = pw?.night_shift || pout <= pin ? 1440 + pout : pout;
      const rest = 1440 + entry - exitAbs;
      if (rest < 11 * 60) { shortRest.push(`${name(a.collaborator_id)} · descanso de ${Math.floor(rest / 60)}h${String(rest % 60).padStart(2, "0")}`); break; }
    }
  }
  if (shortRest.length) out.push({ key: "v10", tone: "red", title: `${shortRest.length} pessoa(s) com menos de 11h de descanso entre jornadas`, people: shortRest });

  // L1: ASO, integração (no cliente escalado) ou treinamento vencendo em até 7 dias.
  const limit = addDaysIso(d.date, 7);
  const soon = (e: string | null) => !!e && e >= d.date && e <= limit;
  const latestBy = <T extends { expires_at: string | null }>(list: T[], key: (x: T) => string) => {
    const m = new Map<string, T>();
    for (const x of list) { const k = key(x); const cur = m.get(k); if (!cur || (x.expires_at ?? "") > (cur.expires_at ?? "")) m.set(k, x); }
    return m;
  };
  const staff = new Set(d.allocations.map((a) => a.collaborator_id));
  const clientsOf = new Map<string, Set<string>>();
  for (const a of d.allocations) { const c = clientOf(a.work_id); if (c) clientsOf.set(a.collaborator_id, new Set([...(clientsOf.get(a.collaborator_id) ?? []), c])); }
  const expiring: string[] = [];
  for (const x of latestBy(d.asos.filter((x) => staff.has(x.collaborator_id)), (x) => x.collaborator_id).values())
    if (soon(x.expires_at) && !d.covered.has(`aso|${x.collaborator_id}`)) expiring.push(`${name(x.collaborator_id)} · ASO vence ${br(x.expires_at!)}`);
  for (const x of latestBy(d.integrations.filter((x) => !x.documentation && clientsOf.get(x.collaborator_id)?.has(x.client_id)), (x) => `${x.collaborator_id}|${x.client_id}`).values())
    if (soon(x.expires_at) && !d.covered.has(`int|${x.collaborator_id}|${x.client_id}`)) expiring.push(`${name(x.collaborator_id)} · integração ${d.clients.get(x.client_id)?.name ?? ""} vence ${br(x.expires_at!)}`);
  for (const x of latestBy(d.trainings.filter((x) => staff.has(x.collaborator_id)), (x) => `${x.collaborator_id}|${x.training_id}`).values())
    if (soon(x.expires_at) && !d.covered.has(`trn|${x.collaborator_id}|${x.training_id}`)) expiring.push(`${name(x.collaborator_id)} · ${x.name} vence ${br(x.expires_at!)}`);
  if (expiring.length) out.push({ key: "l1", tone: "orange", title: `${expiring.length} documento(s) de escalados vencendo em até 7 dias`, people: expiring.sort() });

  // L2: agendamento do dia sem confirmação na plataforma do cliente.
  const unbooked = d.appointments.filter((a) => a.status === "agendado" && !a.client_booked);
  if (unbooked.length) out.push({ key: "l2", tone: "orange", title: `${unbooked.length} agendamento(s) sem confirmação na plataforma`, people: unbooked.map((a) => `${name(a.collaborator_id)} · ${a.label}`).sort() });

  // L5: quem trabalhou nos últimos 14 dias e está sem escalação, quadro, férias, folga ou agendamento (só em dia útil).
  if (businessDay && d.scheduleExists && d.allocations.length) {
    // Intermitentes e PJ não contam: trabalham só quando chamados.
    const idle = [...d.recent].filter((id) => { const p = d.people.get(id); return p?.active && !["intermitente", "pj"].includes(String(p.contract ?? "").toLowerCase()) && !staff.has(id) && !d.accounted.has(id); }).map(name).sort();
    if (idle.length) out.push({ key: "l5", tone: "orange", title: `${idle.length} pessoa(s) sem escalação no dia`, people: idle });
  }
  return out.sort((a, b) => Number(b.tone === "red") - Number(a.tone === "red"));
}

export const worstAlertTone = (list: ScheduleAlert[]): AlertTone | null =>
  list.some((a) => a.tone === "red") ? "red" : list.length ? "orange" : null;

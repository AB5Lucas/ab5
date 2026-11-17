import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/results-engine";
import { normalizePlate, registeredPlate } from "@/lib/fleet-costs";
import { canonicalDriver, closestPlate, fixedRateio, fuelRateio, isoDay, withDateFix, matchDriverName, nameKey, plateRuleSplit, titleCase, type CcSplitItem, noteStatus, otherPlates, type ItemAccount, type Rateio, type RateioClient, type RateioWork } from "@/lib/fleet-notes";
import { monthsInRange, type DayRange } from "@/components/date-range-picker";
import { useCnhPeople, useFleetRelease } from "./liberacao";
import { GUACU_CNPJ } from "@/lib/fleet-balance";
import { nonTicketTotal } from "@/lib/fleet-fiscal";
import type { Tables } from "@/integrations/supabase/types";

export type Note = Tables<"fleet_fuel_notes">;
export type Row = Note & { itemCount: number; day: string | null; xmlDay: string | null; plateShown: string | null; kmShown: number | null; driverShown: string | null; vehicleLabel: string | null; rateio: Rateio | null; status: ReturnType<typeof noteStatus>; warnings: string[] };

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/**
 * Abastecimentos do período com placa, motorista e rateio por CC (o mesmo cálculo da aba Abastecimentos).
 * Usado também pela subaba Fiscal, para os totais por CC baterem com a aba Abastecimentos.
 */
export function useFuelRows(range: DayRange) {
  const months = monthsInRange(range);
  const start = range.from, end = range.to, lookback = addDays(start, -90);
  const settings = useQuery({ queryKey: ["fleet-settings"], queryFn: async () => Object.fromEntries(((await supabase.from("fleet_settings").select("key, value")).data ?? []).map((s) => [s.key, s.value])) as Record<string, string | null> });
  const notes = useQuery({
    queryKey: ["fleet-fuel-notes", start, end],
    queryFn: () => fetchAll<Note>((a, b) => supabase.from("fleet_fuel_notes").select("*")
      .or(`ref_month.in.(${months.join(",")}),and(issued_at.gte.${lookback},issued_at.lte.${end}T23:59:59),and(issued_on_fix.gte.${lookback},issued_on_fix.lte.${end})`).order("issued_at").range(a, b)),
  });
  const docs = useQuery({ queryKey: ["fleet-note-docs", months.join(",")], queryFn: async () => (await supabase.from("fleet_note_docs").select("ref_month, file_name, item_id, read_nf, read_plate, read_total, read_error").in("ref_month", months).order("file_name")).data ?? [] });
  const vehicles = useQuery({ queryKey: ["fleet-vehicles-basic"], queryFn: async () => (await supabase.from("vehicles").select("id, plate, model").order("plate")).data ?? [] });
  const cnh = useCnhPeople();
  const release = useFleetRelease();
  const schedules = useQuery({
    queryKey: ["fleet-rateio-schedules", lookback, end],
    queryFn: () => fetchAll<any>((a, b) => supabase.from("vehicle_schedules").select("vehicle_id, schedule_date, client_id, extra_client_ids, is_maintenance, km, trips, extra_km, work_id, is_suzano_local, driver_id, extra_driver_ids, extra_work_ids")
      .gte("schedule_date", lookback).lte("schedule_date", end).order("schedule_date").range(a, b)),
  });
  const clients = useQuery({ queryKey: ["fleet-rateio-clients"], queryFn: async () => ((await supabase.from("clients").select("id, name, cc_prefix")).data ?? []) as RateioClient[] });
  const works = useQuery({ queryKey: ["fleet-rateio-works"], queryFn: async () => ((await supabase.from("works").select("id, client_id, cc_suffix, active, name")).data ?? []) as RateioWork[] });
  const accounts = useQuery({ queryKey: ["fleet-item-accounts"], queryFn: async () => ((await supabase.from("fleet_item_accounts").select("*").order("cc_code")).data ?? []) as Tables<"fleet_item_accounts">[] });
  const people = useQuery({ queryKey: ["users-names"], queryFn: async () => new Map(((await supabase.from("users_profiles").select("id, full_name")).data ?? []).map((u) => [u.id, u.full_name])) });

  const rows = useMemo<Row[]>(() => {
    const xmlDayOf = new Map((notes.data ?? []).map((n) => [n.id, isoDay(n.issued_at)]));
    const all = (notes.data ?? []).map(withDateFix);
    // Placa e motorista da nota → cadastrados: primeiro entre os liberados no posto na data da nota (aba Liberação:
    // ativo e entre a data de liberação e a de exclusão), depois todos. O nome aparece como o cadastrado, com
    // maiúscula só na primeira letra de cada nome.
    const allPlates = (vehicles.data ?? []).map((v) => v.plate);
    const cnhNames = (cnh.data ?? []).map((c) => c.full_name);
    const dayCache = new Map<string, { plates: string[]; names: string[] }>();
    const releasedOn = (day: string | null) => {
      const k = day ?? "";
      if (!dayCache.has(k)) {
        const vIds = release.vehicleIdsOn(day), dIds = release.driverIdsOn(day);
        dayCache.set(k, {
          plates: [...(vehicles.data ?? []).filter((v) => vIds.has(v.id)).map((v) => v.plate), ...release.freePlatesOn(day)],
          names: [...(cnh.data ?? []).filter((c) => dIds.has(c.id)).map((c) => c.full_name), ...release.freeNamesOn(day)],
        });
      }
      return dayCache.get(k)!;
    };
    const plateCache = new Map<string, string | null>();
    const plateOf = (n: Note) => {
      if (n.plate_fix) return normalizePlate(n.plate_fix) || null;
      const day = isoDay(n.issued_at);
      const k = `${n.plate ?? ""}|${day ?? ""}`;
      if (!plateCache.has(k)) plateCache.set(k, closestPlate(n.plate, releasedOn(day).plates, allPlates));
      return plateCache.get(k)!;
    };
    // Motoristas do veículo na Transporte no dia do abastecimento ou no anterior (para nome curto, ex.: "Celino").
    const cnhName = new Map((cnh.data ?? []).map((c) => [c.id, c.full_name]));
    const schedByVehicleDay = new Map<string, string[]>();
    for (const s of (schedules.data ?? []) as { vehicle_id: string; schedule_date: string; driver_id?: string | null; extra_driver_ids?: string[] | null }[]) {
      const k = `${s.vehicle_id}|${s.schedule_date}`;
      const ids = [s.driver_id, ...(s.extra_driver_ids ?? [])].filter((x): x is string => !!x);
      schedByVehicleDay.set(k, [...(schedByVehicleDay.get(k) ?? []), ...ids.map((id) => cnhName.get(id)).filter((x): x is string => !!x)]);
    }
    // Nome sem casamento: a mesma grafia sem acento vira uma só (prefere a que tem acento).
    const rawByKey = new Map<string, string>();
    for (const n of all) {
      const w = (n.driver_fix ?? n.driver ?? "").trim();
      if (!w) continue;
      const k = nameKey(w), cur = rawByKey.get(k);
      if (!cur || (!/[^\x00-\x7F]/.test(cur) && /[^\x00-\x7F]/.test(w))) rawByKey.set(k, w);
    }
    const driverOf = (n: Note, vehicleId?: string | null) => {
      const day = isoDay(n.issued_at);
      let name = n.driver_fix ?? matchDriverName(n.driver, releasedOn(day).names, cnhNames);
      if (!name && n.driver && vehicleId && day) {
        const onVehicle = [...(schedByVehicleDay.get(`${vehicleId}|${day}`) ?? []), ...(schedByVehicleDay.get(`${vehicleId}|${addDays(day, -1)}`) ?? [])];
        name = matchDriverName(n.driver, onVehicle);
      }
      if (!name && n.driver) name = rawByKey.get(nameKey(n.driver)) ?? n.driver;
      // Nome livre da Liberação ou sem casamento: escrito como no cadastro quando um só colaborador combina.
      name = canonicalDriver(name, cnhNames);
      return name ? titleCase(name) : null;
    };
    // Placa mostrada como cadastrada na Liberação/Veículos (o casamento continua pela forma Mercosul).
    const registered = [...(vehicles.data ?? []).map((v) => v.plate), ...release.vehicles.map((e) => e.plate)];
    const vehicleByPlate = new Map((vehicles.data ?? []).map((v) => [normalizePlate(v.plate), v]));
    const clientMap = new Map((clients.data ?? []).map((c) => [c.id, c]));
    const items = new Map<string, number>();
    for (const n of all) items.set(n.access_key, (items.get(n.access_key) ?? 0) + 1);
    const ordered = [...all].sort((a, b) => String(a.issued_at).localeCompare(String(b.issued_at)) || a.access_key.localeCompare(b.access_key) || a.item_no - b.item_no);
    return ordered.filter((n) => { const d = isoDay(n.issued_at); return !!d && d >= start && d <= end; }).map((n) => {
      const p = plateOf(n);
      const v = p ? vehicleByPlate.get(p) : undefined;
      const day = isoDay(n.issued_at);
      const idx = ordered.indexOf(n);
      // Abastecimento anterior do mesmo veículo (outro XML: os itens do mesmo XML são o mesmo abastecimento).
      const prev = p ? [...ordered.slice(0, idx)].reverse().find((o) => o.access_key !== n.access_key && plateOf(o) === p) : undefined;
      const acc = (accounts.data ?? []) as ItemAccount[];
      const split = (Array.isArray(n.cc_split) ? n.cc_split : []) as unknown as CcSplitItem[];
      const plateSplit = plateRuleSplit(p, acc);
      const rateio = n.approved_at && n.allocation ? (n.allocation as unknown as Rateio)
        // CCs informados à mão no Editar (um ou mais, com %): sem rateio pela Transporte.
        : split.length ? fixedRateio(split, Number(n.total ?? 0), day, "CC informado à mão", acc)
        : n.cc_fix ? fixedRateio([{ cc_code: n.cc_fix, item_account: n.item_account_fix, label: n.cc_label_fix, pct: 100 }], Number(n.total ?? 0), day, "CC informado à mão", acc)
        // Placa com CC fixo (ex.: DAJ5I66 → 2004221).
        : plateSplit ? fixedRateio(plateSplit, Number(n.total ?? 0), day, `placa ${p} vai sempre para o CC ${plateSplit[0]!.cc_code}`, acc)
        : day && schedules.data ? fuelRateio({ vehicleId: v?.id ?? null, day, prevDay: isoDay(prev?.issued_at ?? null), total: Number(n.total ?? 0), schedules: schedules.data, clients: clientMap, works: works.data ?? [], accounts: (accounts.data ?? []) as ItemAccount[] })
        : null;
      const kmShown = n.km_fix ?? n.km;
      const prevKm = prev ? prev.km_fix ?? prev.km : null;
      const warnings = [
        ...(n.plate_fix ? [] : otherPlates(n.info, normalizePlate(n.plate ?? "") || p).filter((o) => o !== p).map((o) => `outra placa no texto da nota: ${o}`)),
        ...(kmShown != null && prevKm != null && Number(kmShown) < Number(prevKm) ? [`km menor que o abastecimento anterior (${Number(prevKm).toLocaleString("pt-BR")})`] : []),
      ];
      return { ...n, day, xmlDay: xmlDayOf.get(n.id) ?? day, plateShown: registeredPlate(p, registered), kmShown, driverShown: driverOf(n, v?.id), vehicleLabel: v ? (v.model ?? v.plate) : p ? release.freeVehicleLabel.get(p) ?? null : null, rateio, status: noteStatus(n), warnings, itemCount: items.get(n.access_key) ?? 1 };
    });
  }, [notes.data, vehicles.data, clients.data, works.data, accounts.data, schedules.data, start, end, cnh.data, release.drivers, release.vehicles]);
  const loading = notes.isLoading || schedules.isLoading || vehicles.isLoading;
  return { settings, notes, docs, vehicles, schedules, accounts, people, rows, loading };
}

/** Soma das faturas do posto em aberto (Pago? = NÃO), para o quadro Saldo. */
export function useOpenInvoicesTotal() {
  return useQuery({
    queryKey: ["fleet-invoices", "open-total"],
    queryFn: async () => ((await supabase.from("fleet_invoices").select("total").eq("paid", false)).data ?? []).reduce((s, i) => s + Number(i.total ?? 0), 0),
  });
}

/** Partes do Saldo: faturas em aberto e abastecimentos do Guaçu Brasil depois do fim da última fatura (sem TICKET). */
export async function fetchFleetBalanceParts() {
  const inv = (await supabase.from("fleet_invoices").select("total, paid, period_to")).data ?? [];
  const open = inv.filter((i) => !i.paid).reduce((s, i) => s + Number(i.total ?? 0), 0);
  const lastBilledTo = inv.map((i) => i.period_to).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const from = lastBilledTo ?? addDays(new Date().toISOString().slice(0, 10), -15);
  const notes = await fetchAll<any>((a, b) => supabase.from("fleet_fuel_notes").select("access_key, issued_at, issued_on_fix, total, approved_at, allocation, cc_split, cc_fix")
    .or(`issued_at.gte.${from},issued_on_fix.gt.${from}`).range(a, b));
  const unbilled = notes.map(withDateFix)
    .filter((n) => { const d = isoDay(n.issued_at); return !!d && d > from && String(n.access_key ?? "").slice(6, 20) === GUACU_CNPJ; })
    .reduce((s, n) => s + nonTicketTotal(n), 0);
  return { open, unbilled, lastBilledTo };
}
export function useFleetBalanceParts() {
  return useQuery({ queryKey: ["fleet-invoices", "balance-parts"], queryFn: fetchFleetBalanceParts });
}

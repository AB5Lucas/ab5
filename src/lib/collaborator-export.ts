/** Colunas que podem ir para o Excel de colaboradores (aba Colaboradores › Exportar Excel). */
export type ExportCtx = { names: Map<string, string>; contractLabels: Record<string, string> };
export type ExportColumn = { key: string; label: string; adminOnly?: boolean; value: (c: any, ctx: ExportCtx) => string | number | null };

const br = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : null);
const yesNo = (v: unknown) => (v ? "Sim" : "Não");

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "registration_number", label: "Matrícula", value: (c) => c.registration_number ?? null },
  { key: "full_name", label: "Nome completo", value: (c) => c.full_name ?? null },
  { key: "social_name", label: "Nome social", value: (c) => c.social_name ?? null },
  { key: "cpf", label: "CPF", value: (c) => c.cpf ?? null },
  { key: "rg", label: "RG", value: (c) => c.rg ?? null },
  { key: "position", label: "Função", value: (c, x) => (c.position_id ? x.names.get(c.position_id) ?? null : null) },
  { key: "department", label: "Departamento", value: (c, x) => (c.department_id ? x.names.get(c.department_id) ?? null : null) },
  { key: "status", label: "Situação", value: (c) => (c.status === "inactive" ? "Inativo" : "Ativo") },
  { key: "contract_type", label: "Tipo de contrato", value: (c, x) => x.contractLabels[c.contract_type ?? "efetivo"] ?? c.contract_type ?? null },
  { key: "phone", label: "Telefone", value: (c) => c.phone ?? null },
  { key: "email", label: "E-mail", value: (c) => c.email ?? null },
  { key: "city", label: "Cidade", value: (c) => c.city ?? null },
  { key: "birth_date", label: "Data de nascimento", value: (c) => br(c.birth_date) },
  { key: "hire_date", label: "Data de admissão", value: (c) => br(c.hire_date) },
  { key: "is_driver", label: "Motorista", value: (c) => yesNo(c.is_driver) },
  { key: "driver_license_category", label: "CNH categoria", value: (c) => c.driver_license_category ?? null },
  { key: "driver_license_expiry", label: "CNH validade", value: (c) => br(c.driver_license_expiry) },
  { key: "vt_enabled", label: "Recebe VT", value: (c) => yesNo(c.vt_enabled !== false) },
  { key: "travel_bonus_enabled", label: "Prêmio de viagem", value: (c) => yesNo(c.travel_bonus_enabled !== false) },
  { key: "salary", label: "Salário", adminOnly: true, value: (c) => (c.salary == null ? null : Number(c.salary)) },
  { key: "notes", label: "Observações", value: (c) => c.notes ?? null },
];

export const DEFAULT_EXPORT_KEYS = ["registration_number", "full_name", "position", "status", "contract_type", "phone"];

/** Ordem salva: chaves conhecidas na ordem escolhida, depois as demais na ordem padrão. */
export function orderedColumns(saved: string[] | null, isAdmin: boolean): ExportColumn[] {
  const allowed = EXPORT_COLUMNS.filter((c) => isAdmin || !c.adminOnly);
  const byKey = new Map(allowed.map((c) => [c.key, c]));
  const first = (saved ?? []).map((k) => byKey.get(k)).filter((c): c is ExportColumn => !!c);
  return [...first, ...allowed.filter((c) => !first.includes(c))];
}

/** Linhas da planilha: cabeçalho e uma linha por colaborador, só com as colunas marcadas, na ordem da lista. */
export function exportRows(rows: any[], columns: ExportColumn[], selected: Set<string>, ctx: ExportCtx): (string | number | null)[][] {
  const cols = columns.filter((c) => selected.has(c.key));
  return [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => c.value(r, ctx)))];
}

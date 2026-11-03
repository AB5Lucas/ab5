import { jsPDF } from "jspdf";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";

type DailyAllocation = {
  collaborator_id: string | null;
  daily_schedules: { schedule_date: string } | null;
};

export function filteredDailyAllocations<T extends DailyAllocation>(rows: T[], person: string) {
  return rows.filter((row) => row.collaborator_id === person)
    .sort((a, b) => (a.daily_schedules?.schedule_date ?? "").localeCompare(b.daily_schedules?.schedule_date ?? ""));
}

export async function exportAllocationDailyPdf(person: string, period: string, rows: string[][], filename: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const response = await fetch(ab5Logo.url);
  if (!response.ok) throw new Error("Não foi possível carregar o logo");
  const logo = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler o logo"));
    reader.readAsDataURL(response.blob ? undefined as never : undefined as never);
  });
  return { doc, logo };
}
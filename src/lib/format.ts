/**
 * Format BRL currency. Use with className="tabular" / font-mono for nice alignment.
 */
export function formatBRL(value: number | null | undefined): string {
  const v = typeof value === "number" ? value : 0;
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDateBR(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d + "T12:00:00") : d;
  return date.toLocaleDateString("pt-BR");
}

export const monthNames = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export function currentMonthYear(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

/**
 * Returns YYYY-MM-DD string in LOCAL time (not UTC).
 * This prevents the timezone shift issue where toISOString() converts to UTC.
 */
export function localDateString(d?: Date): string {
  const date = d || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns the first day of a given month/year in YYYY-MM-DD format (local time).
 */
export function firstDayOfMonth(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
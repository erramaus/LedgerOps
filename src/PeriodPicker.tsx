import { monthLabel, type Period } from "../shared/period";

const MONTH_NAMES = Array.from({ length: 12 }, (_, index) => monthLabel({ year: 2000, month: index + 1 }).split(" ")[0]);

export function PeriodPicker({ period, today, onChange }: { period: Period; today: string; onChange: (period: Period) => void }) {
  const thisYear = Number(today.slice(0, 4));
  const first = Math.min(thisYear - 3, period.year);
  const years = Array.from({ length: Math.max(thisYear, period.year) - first + 1 }, (_, index) => first + index);
  return (
    <div className="period-picker" role="group" aria-label="Accounting period">
      <label>
        Month
        <select value={period.month} onChange={(event) => onChange({ ...period, month: Number(event.target.value) })}>
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={index + 1}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        Year
        <select value={period.year} onChange={(event) => onChange({ ...period, year: Number(event.target.value) })}>
          {years.map((year) => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

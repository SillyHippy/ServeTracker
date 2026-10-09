import React, { useRef } from "react";
import { Input } from "@/components/ui/input";

interface OccurrenceInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}

/** Text inputs work on phones even when the browser's native date picker fails. */
export function OccurrenceInput({ id, value, onChange, required = true }: OccurrenceInputProps) {
  const picker = useRef<HTMLInputElement>(null);
  const [date = "", time = ""] = value.split("T");
  return (
    <div className="space-y-1">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-[130px] flex-1">
          <label htmlFor={`${id}-date`} className="text-xs font-medium">Date (YYYY-MM-DD)</label>
          <Input id={`${id}-date`} type="text" inputMode="numeric" autoComplete="off" placeholder="YYYY-MM-DD"
            value={date} onChange={(e) => onChange(`${e.target.value}T${time}`)} required={required} className="h-10" />
        </div>
        <div className="min-w-[105px] flex-1">
          <label htmlFor={`${id}-time`} className="text-xs font-medium">Time (24h HH:MM)</label>
          <Input id={`${id}-time`} type="text" inputMode="numeric" autoComplete="off" placeholder="HH:MM"
            value={time} onChange={(e) => onChange(`${date}T${e.target.value}`)} required={required} className="h-10" />
        </div>
      </div>
      <button type="button" className="text-xs text-blue-600 underline" onClick={() => {
        const input = picker.current;
        if (!input) return;
        try { input.showPicker?.(); } catch { input.focus(); input.click(); }
        if (!input.showPicker) { input.focus(); input.click(); }
      }}>Choose with device picker (optional)</button>
      <input ref={picker} aria-label="Device date and time picker" type="datetime-local"
        value={/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)} className="absolute h-px w-px opacity-0 pointer-events-none" tabIndex={-1} />
    </div>
  );
}

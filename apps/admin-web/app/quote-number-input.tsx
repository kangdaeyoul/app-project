"use client";
import { useEffect, useState, type InputHTMLAttributes } from "react";
// Keep the editable string separate from the numeric calculation model.
export default function QuoteNumberInput({
  value = "",
  onValue,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value?: number | string;
  onValue?: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value === 0 ? "" : String(value));
  useEffect(() => {
    setDraft((current) =>
      Number(current || 0) === Number(value)
        ? current
        : value === 0
          ? ""
          : String(value),
    );
  }, [value]);
  return (
    <input
      {...props}
      type="number"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onValue?.(Number(e.target.value || 0));
        onChange?.(e);
      }}
    />
  );
}

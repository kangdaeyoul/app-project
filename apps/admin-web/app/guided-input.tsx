"use client";
import type { InputHTMLAttributes } from "react";
import GuidedNumberInput from "./quote-number-input";
export default function GuidedInput(
  props: InputHTMLAttributes<HTMLInputElement>,
) {
  return props.type === "number" ? (
    <GuidedNumberInput
      {...props}
      value={
        typeof props.value === "string" || typeof props.value === "number"
          ? props.value
          : ""
      }
    />
  ) : (
    <input {...props} />
  );
}

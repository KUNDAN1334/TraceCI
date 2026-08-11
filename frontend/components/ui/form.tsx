"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const CONTROL =
  "w-full rounded-md border border-line-strong bg-canvas px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle/70 hover:border-line-strong/80 focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-50";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
  action,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle"
        >
          {label}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-relaxed text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  mono?: boolean;
  action?: ReactNode;
  fieldClassName?: string;
};

export function TextInput({
  label,
  hint,
  error,
  mono = false,
  className,
  action,
  fieldClassName,
  id,
  ...rest
}: TextInputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={inputId}
      action={action}
      className={fieldClassName}
    >
      <input
        id={inputId}
        className={cn(CONTROL, "h-9", mono && "font-mono text-[13px]", className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  action?: ReactNode;
  fieldClassName?: string;
};

export function Select({
  label,
  hint,
  error,
  className,
  children,
  action,
  fieldClassName,
  id,
  ...rest
}: SelectProps) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={selectId}
      action={action}
      className={fieldClassName}
    >
      <div className="relative">
        <select
          id={selectId}
          className={cn(CONTROL, "h-9 appearance-none pr-9", className)}
          {...rest}
        >
          {children}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-subtle"
        >
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </div>
    </Field>
  );
}

/** Segmented control. Used for history filtering and key retention. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex rounded-md border border-line bg-canvas p-0.5", className)}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          title={opt.hint}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded px-3 py-1 text-[13px] font-medium transition-colors",
            value === opt.value
              ? "bg-elevated text-fg shadow-panel"
              : "text-fg-subtle hover:text-fg"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

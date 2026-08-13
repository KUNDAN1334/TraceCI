"use client";

import {
  useId,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
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

// `name` is omitted from the type on purpose, so it cannot be reintroduced.
// See the note about form history below.
type SecretInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "name"> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  action?: ReactNode;
  fieldClassName?: string;
};

/**
 * A masked field for a secret that is **not** a login credential.
 *
 * Deliberately `type="text"` with CSS masking rather than `type="password"`,
 * and that is the whole point of the component.
 *
 * A browser password manager keys off `type="password"`. Put one inside a
 * form, submit the form, and Chrome offers to save the value to Google
 * Password Manager -- taking whatever text field sits above it as the
 * "username". For a login form that is correct and helpful. For a
 * bring-your-own-key field it means a provider API key gets written into the
 * user's password vault, labelled with a git branch name.
 *
 * `autocomplete="new-password"` suppresses *autofill* but not the save prompt;
 * there is no attribute that reliably does. The only dependable fix is for the
 * field not to be a password field. `-webkit-text-security` gives the same
 * visual masking without the semantics, and is supported in Chrome, Edge,
 * Safari and Firefox 118+.
 *
 * The reveal toggle is not decoration: once the input is technically plain
 * text, a user needs an obvious way to confirm what they pasted, and the
 * browser's own "show password" eye is no longer there to do it.
 *
 * Deliberately has **no `name` attribute**, and the prop is removed from the
 * type so it cannot be added back. Dropping `type="password"` trades one
 * browser feature for another: a *named* text input inside a submitted form is
 * eligible for Chrome's form history, the saved-values dropdown that appears
 * when you click into a field. `autocomplete="off"` asks Chrome not to, but
 * Chrome does not always honour it. A field with no name has no key to be
 * stored under, which is a guarantee rather than a request -- and the name was
 * never doing anything anyway, since the value is sent as JSON by `fetch`, not
 * by a native form POST.
 */
export function SecretInput({
  label,
  hint,
  error,
  className,
  action,
  fieldClassName,
  id,
  ...rest
}: SecretInputProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const [revealed, setRevealed] = useState(false);

  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={inputId}
      action={action}
      className={fieldClassName}
    >
      <div className="relative">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          style={
            revealed ? undefined : ({ WebkitTextSecurity: "disc" } as CSSProperties)
          }
          className={cn(CONTROL, "h-9 pr-10 font-mono text-[13px]", className)}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? "Hide the key" : "Show the key"}
          className="absolute right-1 top-1/2 grid h-7 w-8 -translate-y-1/2 place-items-center rounded text-fg-subtle transition-colors hover:text-fg"
        >
          {revealed ? (
            <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
              <path
                d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M3 13 13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
              <path
                d="M2 8s2.2-3.5 6-3.5S14 8 14 8s-2.2 3.5-6 3.5S2 8 2 8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>
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

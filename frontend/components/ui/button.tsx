import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45";

const VARIANTS: Record<ButtonVariant, string> = {
  // Neutral-inverted rather than a brand colour: it reads as "the action" in
  // both themes without adding a third hue to the page.
  primary: "bg-fg text-canvas hover:bg-fg/90 active:bg-fg/80",
  secondary:
    "border border-line-strong bg-surface text-fg hover:bg-elevated hover:border-line-strong/80",
  ghost: "text-fg-muted hover:bg-elevated hover:text-fg",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string
) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonProps) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const cls = buttonClass(variant, size, className);
  if (/^https?:/.test(href)) {
    return (
      <a href={href} className={cls} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

"use client";

/**
 * Stage 3.12B-W1 — one control type for every deliberate Session room exit.
 *
 * A plain `<Link>` out of the room leaves the `SessionRoomConnection` lease
 * untouched, so other participants keep seeing `IN_SESSION` until the lease
 * lapses. Every product action that intentionally leaves the room therefore
 * renders through this control, which hands the destination to the room's
 * canonical explicit-leave sequence instead of navigating on its own.
 *
 * Without a handler it degrades to the original link, which is what the LiveKit
 * room and any surface with no leave sequence still get. Route changes the user
 * did not ask for — refresh, tab close, dropped network — never reach this
 * control and keep their lease-expiry semantics.
 */

import type { ReactNode } from "react";

import {
  GradientButton,
  GradientButtonLink,
  SecondaryButton,
  SecondaryButtonLink,
} from "@/components/ui/buttons";

export type RoomExitHandler = (destination: string) => void | Promise<void>;

export type RoomExitControlProps = {
  /** Destination the user asked for. Passed to the handler, never followed here. */
  href: string;
  /** Canonical explicit-leave sequence. When absent the control stays a link. */
  onExit?: RoomExitHandler | null;
  variant: "secondary" | "gradient";
  children: ReactNode;
  /** Label shown while the leave request is in flight. */
  pendingChildren?: ReactNode;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  "aria-label"?: string;
  title?: string;
};

export function RoomExitControl({
  href,
  onExit,
  variant,
  children,
  pendingChildren,
  pending = false,
  disabled = false,
  className,
  "data-testid": testId,
  "aria-label": ariaLabel,
  title,
}: RoomExitControlProps) {
  if (!onExit) {
    const LinkComponent =
      variant === "gradient" ? GradientButtonLink : SecondaryButtonLink;
    return (
      <LinkComponent
        href={href}
        className={
          disabled ? `pointer-events-none opacity-60 ${className ?? ""}`.trim() : className
        }
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        title={title}
        data-testid={testId}
      >
        {children}
      </LinkComponent>
    );
  }

  const ButtonComponent = variant === "gradient" ? GradientButton : SecondaryButton;
  return (
    <ButtonComponent
      type="button"
      className={className}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-disabled={disabled || pending || undefined}
      aria-label={ariaLabel}
      title={title}
      data-testid={testId}
      onClick={() => void onExit(href)}
    >
      {pending && pendingChildren ? pendingChildren : children}
    </ButtonComponent>
  );
}

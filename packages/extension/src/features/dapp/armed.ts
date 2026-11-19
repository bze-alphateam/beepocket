import { useEffect, useRef, useState } from 'preact/hooks';
import { useHomeEnv } from '../home/env';

/** How long Approve and Connect stay inactive after a request shows or the window comes back. */
const ARM_MS = 500;

/** The buttons the delay holds: the approving ones, never Reject or Cancel. */
const HELD = 'button[type=submit], .bp-btn-primary, .bp-btn-danger';

function heldButton(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(HELD) : null;
}

/** Spread on the element that wraps a request's answer buttons. */
export interface ArmGuard {
  onPointerDownCapture: (e: Event) => void;
  onKeyDownCapture: () => void;
  onClickCapture: (e: Event) => void;
}

export interface Armed {
  /** Whether the approving buttons respond yet; render them disabled until then. */
  armed: boolean;
  guard: ArmGuard;
}

/**
 * Approve and Connect respond only `ARM_MS` after the screen shows (each request instance gets
 * its own screen) and after every return of the window to the front. A click whose press began
 * before that, or that lands before the next render, is dropped.
 */
export function useArmed(): Armed {
  const { arming } = useHomeEnv();
  const [armed, setArmed] = useState(false);
  // Read at event time: the click that brings the window back comes before any render.
  const live = useRef(false);
  const round = useRef(0);
  const press = useRef<{ button: Element; round: number; live: boolean } | null>(null);

  useEffect(() => {
    let cancel: () => void = () => undefined;
    const start = () => {
      cancel();
      round.current += 1;
      live.current = false;
      setArmed(false);
      cancel = arming.after(ARM_MS, () => {
        live.current = true;
        setArmed(true);
      });
    };
    start();
    const off = arming.subscribe(start);
    return () => {
      off();
      cancel();
    };
  }, [arming]);

  const guard: ArmGuard = {
    onPointerDownCapture: (e) => {
      const button = heldButton(e.target);
      press.current = button === null ? null : { button, round: round.current, live: live.current };
    },
    // A key press carries no pointer press: it counts once the buttons respond.
    onKeyDownCapture: () => {
      press.current = null;
    },
    onClickCapture: (e) => {
      const button = heldButton(e.target);
      if (button === null) return;
      const pressed = press.current;
      press.current = null;
      // A pointer click (`detail` counts its presses) must have been pressed on this button while
      // it responded, in this round; a key or a script click has no press of its own.
      const pointer = e instanceof MouseEvent && e.detail > 0;
      const pressOk =
        pressed !== null && pressed.button === button
          ? pressed.live && pressed.round === round.current
          : !pointer;
      if (live.current && pressOk) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };
  return { armed, guard };
}

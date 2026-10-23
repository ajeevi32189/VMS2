import { useEffect, useRef } from "react";

/**
 * STQC Step 2.1 (Point 25): Idle timeout hook
 * Sir's doc: 15 min of no user activity → auto logout
 * Live stream / background polling is NOT counted as activity (only real user input events).
 */
const IDLE_MS = 15 * 60 * 1000; // 15 minutes

const USER_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

export const useIdleTimer = (onIdle) => {
  const timerRef = useRef(null);

  useEffect(() => {
    const resetIdle = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onIdle();
      }, IDLE_MS);
    };

    // Start the timer immediately
    resetIdle();

    // Listen to real user input only (Sir's doc: stream/polling NOT counted)
    USER_EVENTS.forEach((event) =>
      window.addEventListener(event, resetIdle, { passive: true })
    );

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      USER_EVENTS.forEach((event) =>
        window.removeEventListener(event, resetIdle)
      );
    };
  }, [onIdle]);
};

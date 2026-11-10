import { useSyncExternalStore } from 'react';

let currentTimestamp = 0;
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;

function startClock() {
  if (typeof window === 'undefined' || intervalId !== null) return;
  currentTimestamp = Date.now();
  intervalId = setInterval(() => {
    currentTimestamp = Date.now();
    listeners.forEach((listener) => listener());
  }, 1000);
}

function stopClock() {
  if (intervalId !== null && listeners.size === 0) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  if (listeners.size === 1) {
    startClock();
  }
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      stopClock();
    }
  };
}

function getSnapshot(): number {
  return currentTimestamp;
}

function getServerSnapshot(): number {
  return 0;
}

/**
 * React 19 compliant hook for subscribing to a 1-second live clock.
 * Avoids impure Date.now() render calls and cascading setState effects.
 */
export function useCurrentTime(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

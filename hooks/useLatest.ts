"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Keeps a ref pointed at the newest value without reading or writing it during
 * render. Long-lived callbacks (WebSocket handlers, AudioWorklet messages) read
 * through this instead of closing over stale props.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

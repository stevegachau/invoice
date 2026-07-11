import { useEffect, useState } from "react";

// pointer:coarse asks close to the right question for this use case — "is
// this device driven by taps, where opening a wallet app via an ethereum:
// link makes sense" — and correctly excludes a merely-narrow desktop
// window, unlike a viewport-width check. Falls back to a UA regex only for
// browsers old enough not to support the media feature at all.
export function useIsCoarsePointer(): boolean {
  const [isCoarse, setIsCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia) {
      const mq = window.matchMedia("(pointer: coarse)");
      if (mq.media !== "not all") {
        setIsCoarse(mq.matches);
        const onChange = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
      }
    }

    // Fallback for browsers without pointer-media-feature support.
    setIsCoarse(/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  return isCoarse;
}

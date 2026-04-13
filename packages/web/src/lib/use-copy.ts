import { useCallback, useEffect, useRef, useState } from "react";

export function useCopy(resetMs = 2000) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string, index = 0) => {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopiedIndex(null);
        timerRef.current = null;
      }, resetMs);
    },
    [resetMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { copiedIndex, copy };
}

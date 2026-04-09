import { useCallback, useState } from "react";

export function useCopy(resetMs = 2000) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copy = useCallback(
    async (text: string, index = 0) => {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), resetMs);
    },
    [resetMs],
  );

  return { copiedIndex, copy };
}

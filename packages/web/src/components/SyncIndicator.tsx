import { UI } from "../lib/strings.js";

export function SyncIndicator({
  syncing,
  show,
  pendingCount,
  onSync,
}: Readonly<{
  syncing: boolean;
  show: boolean;
  pendingCount: number;
  onSync: () => void;
}>) {
  const visible = syncing || (show && pendingCount > 0);
  return (
    <span role="status" aria-live="polite">
      <button
        type="button"
        onClick={onSync}
        disabled={syncing || pendingCount === 0}
        className="text-xs text-accent/80 font-medium disabled:opacity-40 transition-all duration-300"
        style={{ visibility: visible ? "visible" : "hidden" }}
      >
        {syncing ? UI.question.syncing : UI.question.unsynced(pendingCount)}
      </button>
    </span>
  );
}

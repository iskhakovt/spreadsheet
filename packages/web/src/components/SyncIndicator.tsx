import { UI } from "../lib/strings.js";

export function SyncIndicator({
  syncing,
  show,
  pendingCount,
  onSync,
}: {
  syncing: boolean;
  show: boolean;
  pendingCount: number;
  onSync: () => void;
}) {
  const visible = syncing || (show && pendingCount > 0);
  return (
    <span role="status" aria-live="polite">
      <button
        type="button"
        onClick={onSync}
        disabled={syncing || pendingCount === 0}
        className="text-xs text-accent font-medium disabled:opacity-50 transition-opacity"
        style={{ visibility: visible ? "visible" : "hidden" }}
      >
        {syncing ? UI.question.syncing : UI.question.unsynced(pendingCount)}
      </button>
    </span>
  );
}

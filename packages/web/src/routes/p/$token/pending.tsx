import { createFileRoute } from "@tanstack/react-router";
import { Card } from "../../../components/Card.js";
import { CopyMyLink } from "../../../components/copy-my-link.js";
import { cn } from "../../../lib/cn.js";
import { usePersonApp } from "../../../lib/person-app-context.js";

export const Route = createFileRoute("/p/$token/pending")({
  component: PendingRoute,
});

function PendingRoute() {
  const { authedStatus, sortedMembers } = usePersonApp();
  const waitingForAnatomy = authedStatus.group.isAdminReady && !authedStatus.group.isReady;
  const others = sortedMembers.filter((m) => m.id !== authedStatus.person.id);

  return (
    <Card>
      <div className="text-center pt-16 space-y-6">
        <h1 className="text-2xl font-bold">Almost there</h1>
        <p className="text-text-muted">
          {waitingForAnatomy
            ? "Waiting for everyone to finish setting up."
            : "The group is being set up. You'll be able to start once everyone has been added."}
        </p>
        <div className="space-y-2">
          {others.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-4 py-2.5 bg-surface/60 rounded-[var(--radius-sm)] border border-border/30 text-sm"
            >
              <span>{m.name}</span>
              {waitingForAnatomy && (
                <span className={cn("text-xs", m.anatomy ? "text-accent font-medium" : "text-text-muted/70")}>
                  {m.anatomy ? "Ready" : "Setting up..."}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted/70">Only matches are revealed. Checking automatically...</p>
        <CopyMyLink encrypted={authedStatus.group.encrypted} />
      </div>
    </Card>
  );
}

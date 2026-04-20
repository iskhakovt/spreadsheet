import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card } from "../../../components/Card.js";
import { CopyMyLink } from "../../../components/copy-my-link.js";
import { cn } from "../../../lib/cn.js";
import { usePersonApp } from "../../../lib/person-app-context.js";

export const Route = createFileRoute("/p/$token/waiting")({
  component: WaitingRoute,
});

function WaitingRoute() {
  const { token, authedStatus, sortedMembers } = usePersonApp();
  const navigate = useNavigate();
  const others = sortedMembers.filter((m) => m.id !== authedStatus.person.id);

  return (
    <Card>
      <div className="text-center pt-16 space-y-6">
        <h1 className="text-2xl font-bold">Waiting for everyone...</h1>
        <div className="space-y-2.5">
          {others.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-4 py-3 bg-surface/60 rounded-[var(--radius-sm)] border border-border/30"
            >
              <span className="font-medium">{m.name}</span>
              <span className={cn("text-sm", m.isCompleted ? "text-accent font-medium" : "text-text-muted/70")}>
                {m.isCompleted ? "Done" : "In progress..."}
              </span>
            </div>
          ))}
        </div>
        {/* Escape hatch back to editing. Navigates only — does NOT unmark
            completion state, so partners on /results aren't kicked out. */}
        <button
          type="button"
          onClick={() => void navigate({ to: "/p/$token/questions", params: { token } })}
          className="text-sm text-text-muted/70 hover:text-accent transition-colors duration-200 underline underline-offset-2"
        >
          Edit my answers
        </button>
        {authedStatus.person.isAdmin && (
          <button
            type="button"
            onClick={() => void navigate({ to: "/p/$token/group", params: { token } })}
            className="text-sm text-text-muted/70 hover:text-accent transition-colors duration-200 block mx-auto"
          >
            View group members
          </button>
        )}
        <CopyMyLink encrypted={authedStatus.group.encrypted} />
      </div>
    </Card>
  );
}

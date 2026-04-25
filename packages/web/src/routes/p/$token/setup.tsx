import { ANATOMY_LABEL_PRESETS, type Anatomy, type AnatomyLabels } from "@spreadsheet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AnatomyPicker } from "../../../components/AnatomyPicker.js";
import { Button } from "../../../components/Button.js";
import { Card } from "../../../components/Card.js";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { useTRPC } from "../../../lib/trpc.js";

export const Route = createFileRoute("/p/$token/setup")({
  component: SetupRoute,
});

function SetupRoute() {
  const { authedStatus } = usePersonApp();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setProfileMutation = useMutation(
    trpc.groups.setProfile.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }),
    }),
  );

  const showAnatomy = authedStatus.group.questionMode === "filtered" && authedStatus.group.anatomyPicker === "self";
  const anatomyLabelKey = (authedStatus.group.anatomyLabels ?? "anatomical") as AnatomyLabels;
  const labels = ANATOMY_LABEL_PRESETS[anatomyLabelKey];
  const [name, setName] = useState("");
  const [anatomy, setAnatomy] = useState<Anatomy | "">("");
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && (!showAnatomy || anatomy) && !setProfileMutation.isPending;

  return (
    <Card>
      <div className="animate-in space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Welcome</h1>
          <p className="text-sm text-text-muted mt-1">Tell us a bit about yourself</p>
        </div>
        <div>
          <label htmlFor="onboard-name" className="block text-sm font-medium mb-2 text-text-muted">
            Your name
          </label>
          <input
            id="onboard-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-4 py-3.5 rounded-[var(--radius-md)] bg-surface/60 border border-border/40 text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all duration-200"
          />
        </div>
        {showAnatomy && (
          <div>
            <label htmlFor="onboard-body" className="block text-sm font-medium mb-2 text-text-muted">
              Your body type
            </label>
            <AnatomyPicker selected={anatomy} onSelect={setAnatomy} labels={labels} />
            <p className="text-xs text-text-muted mt-2 leading-relaxed">
              So we can show only questions that apply to you.
            </p>
          </div>
        )}
        <Button
          fullWidth
          disabled={!canSubmit}
          onClick={() => canSubmit && setProfileMutation.mutate({ name: trimmedName, anatomy: anatomy || null })}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}

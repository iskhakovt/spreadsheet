import {
  ANATOMY_LABEL_PRESETS,
  type Anatomy,
  type AnatomyLabels,
  type Group as GroupData,
  type Member,
  type Person,
} from "@spreadsheet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AnatomyPicker } from "../components/AnatomyPicker.js";
import { Button } from "../components/Button.js";
import { BackLink } from "../components/back-link.js";
import { Card } from "../components/Card.js";
import { CopyLinkField } from "../components/copy-link-field.js";
import { CopyMyLink } from "../components/copy-my-link.js";
import { cn } from "../lib/cn.js";
import { buildPersonLink, wrapSensitive } from "../lib/crypto.js";
import { useAnswers } from "../lib/storage.js";
import { UI } from "../lib/strings.js";
import { useTRPC } from "../lib/trpc.js";
import { useCopy } from "../lib/use-copy.js";

interface GroupProps {
  members: Member[];
  person: Pick<Person, "isCompleted">;
  group: Pick<GroupData, "encrypted" | "isReady" | "questionMode" | "anatomyLabels" | "anatomyPicker">;
  token: string;
  onGroupReady: () => void;
  onStartFilling: () => void;
  onViewAnswers: () => void;
  onBack: () => void;
}

export function Group({
  members,
  person,
  group,
  token,
  onGroupReady,
  onStartFilling,
  onViewAnswers,
  onBack,
}: Readonly<GroupProps>) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [anatomy, setAnatomy] = useState<Anatomy | "">("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const { copiedIndex, copy } = useCopy();

  const addPersonMutation = useMutation(
    trpc.groups.addPerson.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }),
    }),
  );
  const loading = addPersonMutation.isPending;

  const needsAnatomy = group.questionMode === "filtered" && group.anatomyPicker === "admin";
  const labels = group.anatomyLabels
    ? ANATOMY_LABEL_PRESETS[group.anatomyLabels as AnatomyLabels]
    : ANATOMY_LABEL_PRESETS.anatomical;

  // Post-isReady: admin may have returned to this screen. Branch the title +
  // primary CTA by their own progress. `hasAnswers` reads localStorage — the
  // per-person source of truth for partial answers not yet flushed to server.
  const title = group.isReady ? UI.group.titleReady : UI.group.title;
  const answers = useAnswers();
  const hasAnswers = Object.keys(answers).length > 0;
  const primaryCta = pickPrimaryCta({ isReady: group.isReady, person, hasAnswers });
  const primaryCtaProps = {
    start: { label: UI.group.startFilling, onClick: onStartFilling },
    continue: { label: UI.group.continueFilling, onClick: onStartFilling },
    view: { label: UI.group.viewAnswers, onClick: onViewAnswers },
  }[primaryCta];

  async function handleAddPerson(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    if (needsAnatomy && !anatomy) return;
    const encName = await wrapSensitive(name);
    const rawAnatomy = needsAnatomy ? (anatomy as string) : null;
    const encAnatomy = rawAnatomy ? await wrapSensitive(rawAnatomy) : rawAnatomy;

    const result = await addPersonMutation.mutateAsync({
      name: encName,
      anatomy: encAnatomy,
      isAdmin,
    });
    setGeneratedLink(buildPersonLink(result.token));
    setName("");
    setAnatomy("");
    setIsAdmin(false);
  }

  return (
    <Card>
      <div className="space-y-8">
        {/* Back chevron appears only once the group is ready — during the
            initial invite/setup flow the screen is forward-only. */}
        {group.isReady && <BackLink onClick={onBack} />}
        <h1 className="text-2xl font-bold">{title}</h1>

        {/* Members list */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-text-muted/80 mb-3">
            {UI.group.members}
          </h3>
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.name}
                className="flex items-center justify-between px-4 py-3 bg-surface/60 rounded-[var(--radius-sm)] border border-border/30"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  {m.isAdmin && (
                    <span className="text-[10px] uppercase tracking-[0.08em] bg-accent/10 text-accent font-semibold px-2 py-0.5 rounded-full">
                      admin
                    </span>
                  )}
                </div>
                {group.isReady && (
                  <span className={cn("text-sm", m.isCompleted ? "text-accent font-medium" : "text-text-muted/70")}>
                    {m.isCompleted
                      ? "Done"
                      : group.questionMode === "filtered" && !m.anatomy
                        ? "Pending setup"
                        : "In progress"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Generated link */}
        {generatedLink && (
          <div className="p-4 bg-surface/50 rounded-[var(--radius-md)] border border-border/30 space-y-3">
            <p className="text-sm text-text-muted">Share this link with your partner:</p>
            <CopyLinkField
              value={generatedLink}
              label="Partner's invite link"
              copied={copiedIndex !== null}
              onCopy={() => copy(generatedLink)}
            />
          </div>
        )}

        {/* Add person form */}
        {showAdd ? (
          <form
            onSubmit={handleAddPerson}
            className="space-y-4 p-4 bg-surface/50 rounded-[var(--radius-md)] border border-border/30"
          >
            <div>
              <label htmlFor="invite-name" className="block text-sm font-medium mb-1.5 text-text-muted">
                Name
              </label>
              <input
                id="invite-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Partner's name"
                className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-bg/80 border border-border/40 text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all duration-200"
              />
            </div>

            {/* Anatomy picker — only shown in admin-picks + filtered mode */}
            {needsAnatomy && (
              <div>
                <label htmlFor="invite-body-type" className="block text-sm font-medium mb-1.5 text-text-muted">
                  Body type
                </label>
                <AnatomyPicker
                  selected={anatomy}
                  onSelect={setAnatomy}
                  labels={labels}
                  unselectedClass="bg-bg/80 border-border/40 text-text-muted"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="admin"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
                className=""
              />
              <label htmlFor="admin" className="text-sm">
                Make admin
              </label>
            </div>
            <div className="flex gap-3">
              <Button fullWidth type="submit" disabled={!name || (needsAnatomy && !anatomy) || loading}>
                {UI.group.addPerson}
              </Button>
              <Button variant="ghost" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : !group.isReady ? (
          <Button variant="neutral" fullWidth onClick={() => setShowAdd(true)}>
            {UI.group.addPerson}
          </Button>
        ) : null}

        {group.isReady ? (
          <Button fullWidth onClick={primaryCtaProps.onClick}>
            {primaryCtaProps.label}
          </Button>
        ) : (
          <Button fullWidth onClick={onGroupReady} disabled={members.length < 2}>
            {UI.group.everyoneAdded}
          </Button>
        )}

        <CopyMyLink encrypted={group.encrypted} token={token} />
      </div>
    </Card>
  );
}

export type PrimaryCta = "start" | "continue" | "view";

export function pickPrimaryCta({
  isReady,
  person,
  hasAnswers,
}: {
  isReady: boolean;
  person: Pick<Person, "isCompleted">;
  hasAnswers: boolean;
}): PrimaryCta {
  if (!isReady) return "start";
  if (person.isCompleted) return "view";
  if (hasAnswers) return "continue";
  return "start";
}

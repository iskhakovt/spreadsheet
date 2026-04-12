import { ANATOMY_LABEL_PRESETS, type Anatomy, type AnatomyLabels } from "@spreadsheet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AnatomyPicker } from "../components/AnatomyPicker.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { getGroupKeyFromUrl, wrapSensitive } from "../lib/crypto.js";
import { useTRPC } from "../lib/trpc.js";
import { useCopy } from "../lib/use-copy.js";

interface Partner {
  name: string;
  anatomy: Anatomy | "";
}

interface GroupSetupProps {
  adminToken: string;
  group: {
    questionMode: string;
    anatomyLabels: string | null;
    anatomyPicker: string | null;
    encrypted: boolean;
  };
}

export function GroupSetup({ adminToken, group }: Readonly<GroupSetupProps>) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [myName, setMyName] = useState("");
  const [myAnatomy, setMyAnatomy] = useState<Anatomy | "">("");
  const [partners, setPartners] = useState<Partner[]>([{ name: "", anatomy: "" }]);
  const [generatedLinks, setGeneratedLinks] = useState<string[]>([]);
  const { copiedIndex: copied, copy: handleCopy } = useCopy();
  const [done, setDone] = useState(false);

  // NOTE: no onSuccess invalidation here — we want the "You're all set"
  // intermediate screen to stay visible until the user clicks "Start filling
  // out". That click triggers the invalidation, which updates status, which
  // makes PersonApp's guard route away from /setup.
  const setupMutation = useMutation(trpc.groups.setupAdmin.mutationOptions());

  const isFiltered = group.questionMode === "filtered";
  const adminPicksAnatomy = isFiltered && group.anatomyPicker === "admin";
  const anatomyLabelKey = (group.anatomyLabels ?? "anatomical") as AnatomyLabels;
  const labels = ANATOMY_LABEL_PRESETS[anatomyLabelKey];
  const loading = setupMutation.isPending;

  const canSubmit =
    myName && (!adminPicksAnatomy || myAnatomy) && partners.every((p) => p.name && (!adminPicksAnatomy || p.anatomy));

  function addPartner() {
    setPartners((prev) => [...prev, { name: "", anatomy: "" }]);
  }

  function updatePartner(index: number, field: keyof Partner, value: string) {
    setPartners((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  function removePartner(index: number) {
    if (partners.length <= 1) return;
    setPartners((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    const groupKey = getGroupKeyFromUrl();

    const encName = await wrapSensitive(myName);
    const rawAnatomy = adminPicksAnatomy ? (myAnatomy as string) : null;
    const encAnatomy = rawAnatomy ? await wrapSensitive(rawAnatomy) : null;

    const encPartners = await Promise.all(
      partners.map(async (p) => {
        const pRawAnatomy = adminPicksAnatomy ? (p.anatomy as string) : null;
        return {
          name: await wrapSensitive(p.name),
          anatomy: pRawAnatomy ? await wrapSensitive(pRawAnatomy) : null,
        };
      }),
    );

    const result = await setupMutation.mutateAsync({
      adminToken,
      name: encName,
      anatomy: encAnatomy,
      partners: encPartners,
    });

    const keyFragment = groupKey ? `#key=${groupKey}` : "";
    const links = result.partnerTokens.map((t) => `${window.location.origin}/p/${t}${keyFragment}`);
    setGeneratedLinks(links);
    setDone(true);
  }

  // After submission — show links and continue button
  if (done && generatedLinks.length > 0) {
    return (
      <Card>
        <div className="animate-in space-y-6">
          <div>
            <h1 className="text-2xl font-bold">You're all set</h1>
            <p className="text-sm text-text-muted mt-1">Share these links with your partners</p>
          </div>

          {partners.map((partner, i) => (
            <div key={i} className="p-4 bg-surface rounded-lg space-y-2">
              <p className="text-sm font-medium">{partner.name}'s link</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedLinks[i]}
                  aria-label={`${partner.name}'s invite link`}
                  className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-sm text-text font-mono truncate"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(generatedLinks[i], i)}
                  aria-label={`Copy ${partner.name}'s link`}
                  className="px-4 py-2 rounded-lg bg-accent text-accent-fg text-sm font-medium shrink-0"
                >
                  {copied === i ? "Copied!" : "Copy"}
                </button>
                <span className="sr-only" aria-live="polite">
                  {copied === i ? "Copied to clipboard" : ""}
                </span>
              </div>
            </div>
          ))}

          <Button fullWidth onClick={() => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() })}>
            Start filling out
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="animate-in space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Set up your group</h1>
          <p className="text-sm text-text-muted mt-1">Add yourself and your partners</p>
        </div>

        {/* Admin's info */}
        <div className="space-y-4">
          <div>
            <label htmlFor="setup-my-name" className="block text-sm font-medium mb-2 text-text-muted">
              Your name
            </label>
            <input
              id="setup-my-name"
              type="text"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-4 py-3.5 rounded-[var(--radius-md)] bg-surface border border-border text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/30 transition-shadow"
            />
          </div>

          {adminPicksAnatomy && (
            <div>
              <label htmlFor="setup-my-body" className="block text-sm font-medium mb-2 text-text-muted">
                Your body type
              </label>
              <AnatomyPicker selected={myAnatomy} onSelect={(v) => setMyAnatomy(v as Anatomy)} labels={labels} />
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Partners */}
        {partners.map((partner, i) => (
          <div key={i} className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-muted">
                {partners.length === 1 ? "Partner" : `Partner ${i + 1}`}
              </p>
              {partners.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePartner(i)}
                  aria-label={`Remove partner ${i + 1}`}
                  className="text-xs text-text-muted hover:text-accent"
                >
                  Remove
                </button>
              )}
            </div>

            <div>
              <label htmlFor={`setup-partner-name-${i}`} className="block text-sm font-medium mb-2 text-text-muted">
                Their name
              </label>
              <input
                id={`setup-partner-name-${i}`}
                type="text"
                value={partner.name}
                onChange={(e) => updatePartner(i, "name", e.target.value)}
                placeholder="Partner's name"
                className="w-full px-4 py-3.5 rounded-[var(--radius-md)] bg-surface border border-border text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/30 transition-shadow"
              />
            </div>

            {adminPicksAnatomy && (
              <div>
                <label htmlFor={`setup-partner-body-${i}`} className="block text-sm font-medium mb-2 text-text-muted">
                  Their body type
                </label>
                <AnatomyPicker
                  selected={partner.anatomy}
                  onSelect={(v) => updatePartner(i, "anatomy", v)}
                  labels={labels}
                />
              </div>
            )}

            {i < partners.length - 1 && <div className="border-t border-border" />}
          </div>
        ))}

        <button
          type="button"
          onClick={addPartner}
          className="text-sm text-accent hover:text-accent/80 transition-colors"
        >
          + Add another person
        </button>

        <Button fullWidth disabled={!canSubmit || loading} onClick={handleSubmit}>
          {loading ? "Setting up..." : "Create & get links"}
        </Button>
      </div>
    </Card>
  );
}

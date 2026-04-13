import { ANATOMY_LABEL_PRESETS, type Anatomy, type AnatomyLabels } from "@spreadsheet/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "lucide-react";
import { useState } from "react";
import { AnatomyPicker } from "../components/AnatomyPicker.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { CopyLinkField } from "../components/copy-link-field.js";
import { buildPersonLink, wrapSensitive } from "../lib/crypto.js";
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

    const links = result.partnerTokens.map((t) => buildPersonLink(t));
    setGeneratedLinks(links);
    setDone(true);
  }

  // After submission — show links and continue button
  if (done && generatedLinks.length > 0) {
    const myLink = buildPersonLink(adminToken);

    return (
      <Card>
        <div className="animate-in space-y-6">
          <div>
            <h1 className="text-2xl font-bold">You're all set</h1>
            <p className="text-sm text-text-muted mt-1">Save your link and share the others with your partners</p>
          </div>

          <div className="p-4 bg-surface/50 rounded-[var(--radius-md)] border border-border/30 space-y-2">
            <div className="flex items-center gap-2">
              <Link size={14} strokeWidth={1.5} className="text-accent shrink-0" />
              <p className="text-sm font-medium">Your link</p>
            </div>
            <p className="text-xs text-text-muted">Save this to access your group from another device</p>
            <CopyLinkField
              value={myLink}
              label="Your invite link"
              copied={copied === 0}
              onCopy={() => handleCopy(myLink, 0)}
            />
          </div>

          {partners.map((partner, i) => (
            <div key={i} className="p-4 bg-surface/50 rounded-[var(--radius-md)] border border-border/30 space-y-2">
              <p className="text-sm font-medium">{partner.name}'s link</p>
              <CopyLinkField
                value={generatedLinks[i]}
                label={`${partner.name}'s invite link`}
                copied={copied === i + 1}
                onCopy={() => handleCopy(generatedLinks[i], i + 1)}
                data-testid="partner-link"
              />
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
              className="w-full px-4 py-3.5 rounded-[var(--radius-md)] bg-surface/60 border border-border/40 text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all duration-200"
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
        <div className="border-t border-border/40" />

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
                  className="text-xs text-text-muted/70 hover:text-accent transition-colors duration-200"
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
                className="w-full px-4 py-3.5 rounded-[var(--radius-md)] bg-surface/60 border border-border/40 text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all duration-200"
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

            {i < partners.length - 1 && <div className="border-t border-border/40" />}
          </div>
        ))}

        <button
          type="button"
          onClick={addPartner}
          className="text-sm text-accent hover:text-accent/75 transition-colors duration-200"
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

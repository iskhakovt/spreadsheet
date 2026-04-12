import type { AnatomyLabels, AnatomyPicker, QuestionMode } from "@spreadsheet/shared";
import { ANATOMY_LABEL_PRESETS } from "@spreadsheet/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { ToggleGroup } from "../components/ToggleGroup.js";
import { generateGroupKey } from "../lib/crypto.js";
import { UI } from "../lib/strings.js";
import { useTRPC } from "../lib/trpc.js";

export function Landing() {
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);

  if (showCreate) {
    return <CreateGroup onCreated={(token) => navigate(`/p/${token}`)} />;
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden">
      {/* Atmospheric backdrop — two organic blobs drift slowly behind the
          content. Pointer-events-none so they never interfere. Hidden from
          screen readers — purely decorative. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="float-a absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full blur-3xl opacity-40"
          style={{ background: "radial-gradient(circle, #e4b898 0%, transparent 65%)" }}
        />
        <div
          className="float-b absolute -bottom-32 -right-20 w-[480px] h-[480px] rounded-full blur-3xl opacity-35"
          style={{ background: "radial-gradient(circle, #d08058 0%, transparent 70%)" }}
        />
        <div
          className="float-a absolute top-1/3 right-1/4 w-[220px] h-[220px] rounded-full blur-3xl opacity-25"
          style={{ background: "radial-gradient(circle, #7aab8e 0%, transparent 70%)", animationDelay: "-8s" }}
        />
      </div>

      <div className="relative text-center max-w-sm w-full">
        <div className="stagger flex justify-center mb-10" style={{ "--stagger-index": 0 } as React.CSSProperties}>
          <img
            src="/logo.svg"
            alt=""
            width="88"
            height="88"
            className="drop-shadow-[0_8px_20px_rgba(208,128,88,0.25)]"
          />
        </div>

        <div className="stagger mb-3" style={{ "--stagger-index": 1 } as React.CSSProperties}>
          <h1 className="text-[3.25rem] leading-[0.95] font-bold tracking-[-0.03em] text-text">{UI.appName}</h1>
        </div>

        <div
          className="stagger mb-10 flex items-center justify-center gap-3"
          style={{ "--stagger-index": 2 } as React.CSSProperties}
        >
          <span className="h-px w-8 bg-accent/40" />
          <p className="text-base text-accent font-medium italic tracking-wide">{UI.tagline}</p>
          <span className="h-px w-8 bg-accent/40" />
        </div>

        <p
          className="stagger text-text-muted leading-[1.7] text-[15px] text-balance mb-10"
          style={{ "--stagger-index": 3 } as React.CSSProperties}
        >
          {UI.landing.description}
        </p>

        <div className="stagger space-y-6" style={{ "--stagger-index": 4 } as React.CSSProperties}>
          <Button fullWidth onClick={() => setShowCreate(true)}>
            {UI.landing.getStarted}
          </Button>

          <p className="text-xs text-text-muted/70 tracking-wide">
            Private <span className="text-text-muted/30 mx-1.5">&middot;</span>
            Encrypted <span className="text-text-muted/30 mx-1.5">&middot;</span>
            No account needed
          </p>
        </div>
      </div>
    </div>
  );
}

function CreateGroup({ onCreated }: Readonly<{ onCreated: (token: string) => void }>) {
  const trpc = useTRPC();
  const [encrypted, setEncrypted] = useState(false);
  const [questionMode, setQuestionMode] = useState<QuestionMode>("filtered");
  const [showTiming, setShowTiming] = useState(false);
  const [anatomyLabels, setAnatomyLabels] = useState<AnatomyLabels>("anatomical");
  const [anatomyPicker, setAnatomyPicker] = useState<AnatomyPicker>("admin");

  const createMutation = useMutation(trpc.groups.create.mutationOptions());

  const isFiltered = questionMode === "filtered";
  const loading = createMutation.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const groupKey = encrypted ? await generateGroupKey() : null;
    const result = await createMutation.mutateAsync({
      encrypted,
      questionMode,
      showTiming,
      anatomyLabels: isFiltered ? anatomyLabels : null,
      anatomyPicker: isFiltered ? anatomyPicker : null,
    });
    if (groupKey) {
      onCreated(`${result.adminToken}#key=${groupKey}`);
    } else {
      onCreated(result.adminToken);
    }
  }

  return (
    <Card>
      <div className="animate-in">
        <h2 className="text-2xl font-bold mb-2">{UI.createGroup.title}</h2>
        <p className="text-sm text-text-muted mb-8">Configure your group settings</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Question mode */}
          <div>
            <p id="question-mode-label" className="text-sm font-medium mb-2 text-text-muted">
              Questions
            </p>
            <ToggleGroup
              options={[
                { value: "filtered" as const, label: "Filter by body" },
                { value: "all" as const, label: "All questions" },
              ]}
              value={questionMode}
              onChange={setQuestionMode}
              aria-label="Question mode"
            />
          </div>

          {/* Filtered mode settings */}
          {isFiltered && (
            <div className="space-y-5 pl-3 border-l-2 border-accent/20">
              {/* Label style */}
              <div>
                <p className="text-xs font-medium mb-2 text-text-muted uppercase tracking-wide">Label style</p>
                <div role="radiogroup" aria-label="Label style" className="flex gap-2 flex-wrap">
                  {(["anatomical", "gendered", "amab", "short"] as const).map((style) => (
                    // biome-ignore lint/a11y/useSemanticElements: button[role=radio] for custom radio group
                    <button
                      key={style}
                      type="button"
                      role="radio"
                      aria-checked={anatomyLabels === style}
                      onClick={() => setAnatomyLabels(style)}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                        anatomyLabels === style
                          ? "bg-accent text-accent-fg border-accent"
                          : "bg-surface border-border text-text-muted hover:border-accent/30"
                      }`}
                    >
                      {ANATOMY_LABEL_PRESETS[style].amab} / {ANATOMY_LABEL_PRESETS[style].afab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Who picks */}
              <div>
                <p className="text-xs font-medium mb-2 text-text-muted uppercase tracking-wide">Who picks?</p>
                <ToggleGroup
                  options={[
                    { value: "admin" as const, label: "I'll set it" },
                    { value: "self" as const, label: "Each person" },
                  ]}
                  value={anatomyPicker}
                  onChange={setAnatomyPicker}
                  size="sm"
                  aria-label="Who picks body type"
                />
              </div>
            </div>
          )}

          {/* Timing */}
          <label htmlFor="show-timing" className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              id="show-timing"
              checked={showTiming}
              onChange={(e) => setShowTiming(e.target.checked)}
              className="mt-0.5"
            />
            <div className="text-sm">
              <span className="font-medium group-hover:text-accent transition-colors">Ask "now or later?"</span>
              <br />
              <span className="text-text-muted text-xs leading-relaxed">
                After yes/willing answers, ask if you want it now or later.
              </span>
            </div>
          </label>

          {/* Encryption */}
          <label htmlFor="encrypted" className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              id="encrypted"
              checked={encrypted}
              onChange={(e) => setEncrypted(e.target.checked)}
              className="mt-0.5"
            />
            <div className="text-sm">
              <span className="font-medium group-hover:text-accent transition-colors">
                {UI.createGroup.encryptedLabel}
              </span>
              <br />
              <span className="text-text-muted text-xs leading-relaxed">{UI.createGroup.encryptedDescription}</span>
            </div>
          </label>

          <Button fullWidth type="submit" disabled={loading}>
            {loading ? "Creating..." : UI.createGroup.create}
          </Button>
        </form>
      </div>
    </Card>
  );
}

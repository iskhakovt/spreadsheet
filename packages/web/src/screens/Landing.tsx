import type { AnatomyLabels, AnatomyPicker, QuestionMode } from "@spreadsheet/shared";
import { ANATOMY_LABEL_PRESETS } from "@spreadsheet/shared";
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { ToggleGroup } from "../components/ToggleGroup.js";
import { generateGroupKey } from "../lib/crypto.js";
import { UI } from "../lib/strings.js";
import { trpc } from "../lib/trpc.js";

export function Landing() {
  const [, navigate] = useLocation();
  const [showCreate, setShowCreate] = useState(false);

  if (showCreate) {
    return <CreateGroup onCreated={(token) => navigate(`/p/${token}`)} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="animate-in text-center space-y-10 max-w-sm w-full">
        <div className="flex justify-center">
          <img src="/logo.svg" alt="" width="80" height="80" className="drop-shadow-sm" />
        </div>

        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tight text-text">{UI.appName}</h1>
          <p className="text-lg text-accent font-medium">{UI.tagline}</p>
        </div>

        <p className="text-text-muted leading-relaxed text-[15px] text-balance">{UI.landing.description}</p>

        <Button fullWidth onClick={() => setShowCreate(true)}>
          {UI.landing.getStarted}
        </Button>

        <p className="text-xs text-text-muted/60">Private. Encrypted. No account needed.</p>
      </div>
    </div>
  );
}

function CreateGroup({ onCreated }: { onCreated: (token: string) => void }) {
  const [encrypted, setEncrypted] = useState(false);
  const [questionMode, setQuestionMode] = useState<QuestionMode>("filtered");
  const [showTiming, setShowTiming] = useState(false);
  const [anatomyLabels, setAnatomyLabels] = useState<AnatomyLabels>("anatomical");
  const [anatomyPicker, setAnatomyPicker] = useState<AnatomyPicker>("admin");
  const [loading, setLoading] = useState(false);

  const isFiltered = questionMode === "filtered";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const groupKey = encrypted ? await generateGroupKey() : null;

      const result = await trpc.groups.create.mutate({
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
    } finally {
      setLoading(false);
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

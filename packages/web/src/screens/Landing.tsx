import type { AnatomyLabels, AnatomyPicker, QuestionMode } from "@spreadsheet/shared";
import { ANATOMY_LABEL_PRESETS } from "@spreadsheet/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SourceLink } from "../components/source-link.js";
import { ToggleGroup } from "../components/ToggleGroup.js";
import { generateGroupKey } from "../lib/crypto.js";
import { UI } from "../lib/strings.js";
import { useTRPC } from "../lib/trpc.js";

export function Landing() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  if (showCreate) {
    return (
      <CreateGroup
        onCreated={(tokenWithKey) => {
          const [token, hash] = tokenWithKey.split("#", 2);
          void navigate({ to: "/p/$token", params: { token }, hash });
        }}
      />
    );
  }

  return (
    <div className="relative min-h-dvh flex flex-col items-center justify-center px-6 overflow-hidden">
      {/* Atmospheric backdrop — organic blobs drift slowly behind the
          content, creating depth and warmth. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="float-a absolute -top-28 -left-20 w-[440px] h-[440px] rounded-full blur-[80px] opacity-35"
          style={{ background: "radial-gradient(circle, #e4b898 0%, transparent 65%)" }}
        />
        <div
          className="float-b absolute -bottom-36 -right-16 w-[500px] h-[500px] rounded-full blur-[90px] opacity-30"
          style={{ background: "radial-gradient(circle, #d08058 0%, transparent 70%)" }}
        />
        <div
          className="float-a absolute top-1/3 right-1/4 w-[200px] h-[200px] rounded-full blur-[70px] opacity-20"
          style={{ background: "radial-gradient(circle, #7aab8e 0%, transparent 70%)", animationDelay: "-8s" }}
        />
      </div>

      <div className="relative text-center max-w-sm w-full">
        <div className="stagger flex justify-center mb-12" style={{ "--stagger-index": 0 } as React.CSSProperties}>
          <img
            src="/logo.svg"
            alt=""
            width="80"
            height="80"
            className="drop-shadow-[0_6px_24px_rgba(208,128,88,0.3)]"
          />
        </div>

        <div className="stagger mb-5" style={{ "--stagger-index": 1 } as React.CSSProperties}>
          <h1 className="text-[3.5rem] leading-[0.92] font-bold tracking-[-0.035em] text-text">{UI.appName}</h1>
        </div>

        <div
          className="stagger mb-12 flex items-center justify-center gap-4"
          style={{ "--stagger-index": 2 } as React.CSSProperties}
        >
          <span className="h-px w-10 bg-gradient-to-r from-transparent to-accent/30" />
          <p className="text-[15px] text-accent font-medium italic tracking-wide">{UI.tagline}</p>
          <span className="h-px w-10 bg-gradient-to-l from-transparent to-accent/30" />
        </div>

        <p
          className="stagger text-text-muted leading-[1.75] text-[15px] text-balance mb-12"
          style={{ "--stagger-index": 3 } as React.CSSProperties}
        >
          {UI.landing.description}
        </p>

        <div className="stagger space-y-7" style={{ "--stagger-index": 4 } as React.CSSProperties}>
          <Button fullWidth onClick={() => setShowCreate(true)}>
            {UI.landing.getStarted}
          </Button>

          <p className="text-[11px] text-text-muted/60 tracking-[0.08em] uppercase font-medium">
            Private <span className="text-text-muted/20 mx-2">&middot;</span>
            Encrypted <span className="text-text-muted/20 mx-2">&middot;</span>
            No account needed
          </p>

          <div className="pt-2">
            <SourceLink />
          </div>
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
        <h2 className="text-2xl font-bold mb-1.5">{UI.createGroup.title}</h2>
        <p className="text-sm text-text-muted mb-8">Configure your group settings</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Question mode */}
          <div>
            <p id="question-mode-label" className="text-sm font-medium mb-2.5 text-text-muted">
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
            <p className="text-xs text-text-muted mt-2 leading-relaxed">
              Filter shows each person only the questions that apply to their body.
            </p>
          </div>

          {/* Filtered mode settings */}
          {isFiltered && (
            <div className="space-y-5 pl-4 border-l-2 border-accent/15">
              {/* Label style */}
              <div>
                <p className="text-xs font-medium mb-2.5 text-text-muted uppercase tracking-[0.1em]">Label style</p>
                <ToggleGroup
                  options={(["anatomical", "gendered", "amab"] as const).map((style) => ({
                    value: style,
                    label: `${ANATOMY_LABEL_PRESETS[style].amab} / ${ANATOMY_LABEL_PRESETS[style].afab}`,
                  }))}
                  value={anatomyLabels}
                  onChange={setAnatomyLabels}
                  size="sm"
                  aria-label="Label style"
                />
                <p className="text-xs text-text-muted mt-2 leading-relaxed">
                  Affects how questions describe bodies, not which ones you see.
                </p>
              </div>

              {/* Who picks */}
              <div>
                <p className="text-xs font-medium mb-2.5 text-text-muted uppercase tracking-[0.1em]">Who picks?</p>
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
                <p className="text-xs text-text-muted mt-2 leading-relaxed">
                  Fill in everyone's body now, or let each person pick their own on arrival.
                </p>
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
              <span className="font-medium group-hover:text-accent transition-colors duration-200">
                Ask "now or later?"
              </span>
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
              <span className="font-medium group-hover:text-accent transition-colors duration-200">
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

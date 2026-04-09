import {
  ANATOMY_LABEL_PRESETS,
  type Anatomy,
  type AnatomyLabels,
  type CategoryData,
  type QuestionData,
} from "@spreadsheet/shared";
import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Redirect, Route, Switch, useLocation, useParams } from "wouter";
import { AnatomyPicker } from "../components/AnatomyPicker.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { handleError, ScreenErrorFallback } from "../components/ErrorFallback.js";
import { setSession } from "../lib/session.js";
import { getHasSeenIntro } from "../lib/storage.js";
import { trpc } from "../lib/trpc.js";
import { useGroupStatus } from "../lib/use-group-status.js";
import { GroupSetup } from "./GroupSetup.js";
import { Intro } from "./Intro.js";
import { Invite } from "./Invite.js";
import { Question } from "./Question.js";
import { Review } from "./Review.js";
import { Summary } from "./Summary.js";

const Comparison = lazy(() => import("./Comparison.js").then((m) => ({ default: m.Comparison })));

type GroupStatus = NonNullable<Awaited<ReturnType<typeof trpc.groups.status.query>>>;
type Person = NonNullable<GroupStatus["person"]>;
type Group = GroupStatus["group"];

function resolveRoute(person: Person, group: Group, allComplete: boolean): string {
  if (!person.name) return "/setup";
  if (allComplete) return "/results";
  if (person.isCompleted) return "/waiting";
  if (person.isAdmin && !group.isAdminReady) return "/invite";
  if (!group.isAdminReady && !person.isAdmin) return "/pending";
  if (group.questionMode === "filtered" && group.isAdminReady && person.anatomy === null) return "/anatomy";
  if (!group.isReady) return "/pending";
  if (!getHasSeenIntro()) return "/intro";
  return "/questions";
}

export function PersonApp() {
  const { token } = useParams<{ token: string }>();
  const [location, navigate] = useLocation();

  // Set session synchronously — must happen before any tRPC call or storage read this render.
  setSession(token);

  // Poll faster (5s) on transitional screens where we're waiting for others
  const fastPoll = ["/waiting", "/pending"].includes(location);
  const { status, refresh: refreshStatus } = useGroupStatus(token, fastPoll ? 5_000 : 30_000);
  const [questionsData, setQuestionsData] = useState<Awaited<ReturnType<typeof trpc.questions.list.query>> | null>(
    null,
  );
  const [startKey, setStartKey] = useState<string | undefined>(undefined);

  useEffect(() => {
    trpc.questions.list.query().then(setQuestionsData);
  }, [token]);

  if (status === "loading") {
    return (
      <Card>
        <div className="flex items-center justify-center pt-32">
          <p className="text-text-muted">Loading...</p>
        </div>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card>
        <div className="text-center pt-32 space-y-4">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-text-muted">Couldn't reach the server. Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => refreshStatus()}
            className="px-6 py-3 rounded-lg bg-accent text-accent-fg font-medium"
          >
            Retry
          </button>
        </div>
      </Card>
    );
  }

  if (status === null) {
    return (
      <Card>
        <div className="text-center pt-32 space-y-4">
          <h1 className="text-2xl font-bold">Link not found</h1>
          <p className="text-text-muted">This link is invalid or has been removed.</p>
        </div>
      </Card>
    );
  }

  // Admin token — group exists but no person yet
  if (!status.person) {
    return (
      <ErrorBoundary FallbackComponent={ScreenErrorFallback} onError={handleError} resetKeys={[location]}>
        <GroupSetup adminToken={token} group={status.group} onDone={refreshStatus} />
      </ErrorBoundary>
    );
  }

  const allComplete = status.members.every((m) => m.isCompleted);
  const defaultRoute = resolveRoute(status.person, status.group, allComplete);

  // Universal guard: if current route doesn't match resolved state, redirect.
  // Freely-navigable routes (/invite, /summary, /review) are exempt.
  const freeRoutes = ["/invite", "/summary", "/review"];
  const shouldRedirect = location !== "/" && location !== defaultRoute && !freeRoutes.includes(location);

  return (
    <ErrorBoundary FallbackComponent={ScreenErrorFallback} onError={handleError} resetKeys={[location]}>
      <Switch>
        {shouldRedirect && <Redirect to={defaultRoute} replace />}

        <Route path="/setup">
          <NonAdminOnboarding status={status} onDone={refreshStatus} />
        </Route>

        <Route path="/pending">
          <PendingScreen status={status} />
        </Route>

        <Route path="/invite">
          <Invite
            members={status.members}
            group={status.group}
            onGroupReady={async () => {
              await trpc.groups.markReady.mutate();
              await refreshStatus();
            }}
            onStartFilling={() => {
              if (!getHasSeenIntro()) navigate("/intro");
              else navigate("/questions");
            }}
          />
        </Route>

        <Route path="/anatomy">
          <PickAnatomyScreen status={status} onDone={refreshStatus} />
        </Route>

        <Route path="/intro">
          <Intro showTiming={status.group.showTiming} onDone={() => navigate("/questions")} />
        </Route>

        <Route path="/questions">
          <Question
            person={status.person}
            group={status.group}
            members={status.members}
            onDone={refreshStatus}
            onSummary={() => navigate("/summary")}
            startKey={startKey}
            onStartKeyConsumed={() => setStartKey(undefined)}
          />
        </Route>

        <Route path="/summary">
          {questionsData ? (
            <Summary
              questions={questionsData.questions as QuestionData[]}
              categories={questionsData.categories as CategoryData[]}
              isAdmin={status.person.isAdmin}
              onNavigateToCategory={(catId) => {
                setStartKey(`welcome:${catId}`);
                navigate("/questions");
              }}
              onBack={() => navigate("/questions")}
              onReview={() => navigate("/review")}
              onViewGroup={() => navigate("/invite")}
            />
          ) : (
            <Card>
              <div className="pt-32 text-center text-text-muted">Loading...</div>
            </Card>
          )}
        </Route>

        <Route path="/review">
          {questionsData ? (
            <Review
              questions={questionsData.questions as QuestionData[]}
              categories={questionsData.categories as CategoryData[]}
              onMarkComplete={async () => {
                await trpc.sync.markComplete.mutate();
                await refreshStatus();
                navigate("/waiting");
              }}
              onViewProgress={() => navigate("/summary")}
              onEditQuestion={(key) => {
                setStartKey(key);
                navigate("/questions");
              }}
            />
          ) : (
            <Card>
              <div className="pt-32 text-center text-text-muted">Loading...</div>
            </Card>
          )}
        </Route>

        <Route path="/waiting">
          <WaitingScreen status={status} allComplete={allComplete} navigate={navigate} />
        </Route>

        <Route path="/results">
          <Suspense
            fallback={
              <Card>
                <div className="pt-32 text-center text-text-muted">Loading results...</div>
              </Card>
            }
          >
            <Comparison
              onBack={async () => {
                await trpc.sync.unmarkComplete.mutate();
                await refreshStatus();
              }}
            />
          </Suspense>
        </Route>

        <Route>
          <Redirect to={defaultRoute} replace />
        </Route>
      </Switch>
    </ErrorBoundary>
  );
}

function NonAdminOnboarding({ status, onDone }: { status: GroupStatus; onDone: () => void | Promise<void> }) {
  const showAnatomy = status.group.questionMode === "filtered" && status.group.anatomyPicker === "self";
  const anatomyLabelKey = (status.group.anatomyLabels ?? "anatomical") as AnatomyLabels;
  const labels = ANATOMY_LABEL_PRESETS[anatomyLabelKey];

  return (
    <OnboardingForm
      showAnatomy={showAnatomy}
      labels={labels}
      onSubmit={async (name, anatomy) => {
        await trpc.groups.setProfile.mutate({ name, anatomy });
        await onDone();
      }}
    />
  );
}

function PendingScreen({ status }: { status: GroupStatus & { person: Person } }) {
  const waitingForAnatomy = status.group.isAdminReady && !status.group.isReady;
  const others = status.members.filter((m) => m.id !== status.person.id);

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
            <div key={m.id} className="flex items-center justify-between px-4 py-2 bg-surface rounded-lg text-sm">
              <span>{m.name}</span>
              {waitingForAnatomy && (
                <span className={`text-xs ${m.anatomy ? "text-accent" : "text-text-muted"}`}>
                  {m.anatomy ? "Ready" : "Setting up..."}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted">Only matches are revealed. Checking automatically...</p>
      </div>
    </Card>
  );
}

function WaitingScreen({
  status,
  allComplete,
  navigate,
}: {
  status: GroupStatus & { person: Person };
  allComplete: boolean;
  navigate: (to: string) => void;
}) {
  return (
    <Card>
      <div className="text-center pt-16 space-y-6">
        <h1 className="text-2xl font-bold">{allComplete ? "Everyone is done!" : "Waiting for everyone..."}</h1>
        <div className="space-y-3">
          {status.members.map((m) => (
            <div key={m.name} className="flex items-center justify-between px-4 py-3 bg-surface rounded-lg">
              <span>{m.name}</span>
              <span className={m.isCompleted ? "text-accent" : "text-text-muted"}>
                {m.isCompleted ? "Done" : "In progress..."}
              </span>
            </div>
          ))}
        </div>
        {allComplete && (
          <button
            type="button"
            onClick={() => navigate("/results")}
            className="w-full px-6 py-4 rounded-lg bg-accent text-accent-fg font-medium"
          >
            View results
          </button>
        )}
        {status.person.isAdmin && (
          <button type="button" onClick={() => navigate("/invite")} className="text-sm text-text-muted">
            View group members
          </button>
        )}
      </div>
    </Card>
  );
}

function PickAnatomyScreen({
  status,
  onDone,
}: {
  status: GroupStatus & { person: Person };
  onDone: () => void | Promise<void>;
}) {
  const anatomyLabelKey = (status.group.anatomyLabels ?? "anatomical") as AnatomyLabels;
  const labels = ANATOMY_LABEL_PRESETS[anatomyLabelKey];
  const [selected, setSelected] = useState<Anatomy | "">("");

  return (
    <Card>
      <div className="space-y-6 pt-12">
        <h1 className="text-2xl font-bold">One quick thing</h1>
        <p className="text-text-muted">Pick your body type so we can show you relevant questions.</p>
        <AnatomyPicker selected={selected} onSelect={setSelected} labels={labels} />
        <Button
          fullWidth
          disabled={!selected}
          onClick={async () => {
            if (!selected) return;
            await trpc.groups.setProfile.mutate({ name: status.person.name, anatomy: selected });
            await onDone();
          }}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}

function OnboardingForm({
  showAnatomy,
  labels,
  onSubmit,
}: {
  showAnatomy: boolean;
  labels: Record<Anatomy, string>;
  onSubmit: (name: string, anatomy: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [anatomy, setAnatomy] = useState<Anatomy | "">("");

  const canSubmit = name && (!showAnatomy || anatomy);

  return (
    <Card>
      <div className="animate-in space-y-6 pt-8">
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
            className="w-full px-4 py-3.5 rounded-[var(--radius-md)] bg-surface border border-border text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/30 transition-shadow"
          />
        </div>

        {showAnatomy && (
          <div>
            <label htmlFor="onboard-body" className="block text-sm font-medium mb-2 text-text-muted">
              Your body type
            </label>
            <AnatomyPicker selected={anatomy} onSelect={setAnatomy} labels={labels} />
          </div>
        )}

        <Button fullWidth disabled={!canSubmit} onClick={() => canSubmit && onSubmit(name, anatomy || null)}>
          Continue
        </Button>
      </div>
    </Card>
  );
}

import {
  ANATOMY_LABEL_PRESETS,
  type Anatomy,
  type AnatomyLabels,
  type CategoryData,
  type QuestionData,
} from "@spreadsheet/shared";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Redirect, Route, Switch, useLocation, useParams } from "wouter";
import { AnatomyPicker } from "../components/AnatomyPicker.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { handleError, ScreenErrorFallback } from "../components/ErrorFallback.js";
import { setSession } from "../lib/session.js";
import { getHasSeenIntro } from "../lib/storage.js";
import { type trpc, useTRPC, wsClient } from "../lib/trpc.js";
import { useLiveStatus } from "../lib/use-live-status.js";
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
  const queryClient = useQueryClient();

  // Set session synchronously — must happen before any tRPC call or storage read this render.
  setSession(token);

  // On token change (rare — normally a fresh page load), close the WS so
  // the new token gets a clean auth handshake via connectionParams, and
  // invalidate any cached server state that isn't token-keyed (so the new
  // person doesn't read the previous person's data). Fixes the PR #8 caveat
  // where wsLink kept the old auth context after in-tab navigation between
  // two /p/:token URLs.
  //
  // Queries keyed by `{ token }` (like groups.status) naturally segregate
  // by cache key so no extra work is needed for them.
  const prevTokenRef = useRef(token);
  useEffect(() => {
    if (prevTokenRef.current !== token) {
      wsClient.close();
      queryClient.invalidateQueries({ queryKey: [["sync"]] });
      queryClient.invalidateQueries({ queryKey: [["questions"]] });
      prevTokenRef.current = token;
    }
  }, [token, queryClient]);

  const { status, refresh: refreshStatus } = useLiveStatus(token);
  const trpcProxy = useTRPC();
  const { data: questionsData } = useSuspenseQuery(trpcProxy.questions.list.queryOptions());
  const [startKey, setStartKey] = useState<string | undefined>(undefined);

  // Mutations share onSuccess: invalidate groups.status so the guard
  // re-evaluates with fresh server state. invalidateQueries returns a promise
  // that the mutation awaits, so onSettled only fires after the refetch
  // completes — no more stale-guard races.
  //
  // NOTE: sync.unmarkComplete has no UI caller — the "Edit my answers" flow
  // navigates without mutating completion state. The server procedure is
  // kept as a safety valve for future admin tools.
  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: trpcProxy.groups.status.pathKey() });
  const markReadyMutation = useMutation(trpcProxy.groups.markReady.mutationOptions({ onSuccess: invalidateStatus }));
  const markCompleteMutation = useMutation(
    trpcProxy.sync.markComplete.mutationOptions({ onSuccess: invalidateStatus }),
  );

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
        <GroupSetup adminToken={token} group={status.group} />
      </ErrorBoundary>
    );
  }

  const allComplete = status.members.every((m) => m.isCompleted);
  const defaultRoute = resolveRoute(status.person, status.group, allComplete);

  // Universal guard: if current route doesn't match resolved state, redirect.
  // Freely-navigable routes are exempt. /questions is in the list because
  // marked-complete users can enter it via the "Edit my answers" buttons on
  // /waiting and /results without triggering an unmark mutation — they keep
  // their completion state, and any new writes land as journal appends that
  // propagate to partners via the sync.onJournalChange subscription.
  const freeRoutes = ["/invite", "/summary", "/review", "/questions"];
  const shouldRedirect = location !== "/" && location !== defaultRoute && !freeRoutes.includes(location);

  return (
    <ErrorBoundary FallbackComponent={ScreenErrorFallback} onError={handleError} resetKeys={[location]}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-accent-fg focus:rounded-lg"
      >
        Skip to content
      </a>
      <main id="main-content">
        <Switch>
          {shouldRedirect && <Redirect to={defaultRoute} replace />}

          <Route path="/setup">
            <NonAdminOnboarding status={status} />
          </Route>

          <Route path="/pending">
            <PendingScreen status={status} />
          </Route>

          <Route path="/invite">
            <Invite
              members={status.members}
              group={status.group}
              onGroupReady={() => markReadyMutation.mutate()}
              onStartFilling={() => {
                if (!getHasSeenIntro()) navigate("/intro");
                else navigate("/questions");
              }}
            />
          </Route>

          <Route path="/anatomy">
            <PickAnatomyScreen status={status} />
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
          </Route>

          <Route path="/review">
            <Review
              questions={questionsData.questions as QuestionData[]}
              categories={questionsData.categories as CategoryData[]}
              onMarkComplete={async () => {
                await markCompleteMutation.mutateAsync();
                navigate("/waiting");
              }}
              onViewProgress={() => navigate("/summary")}
              onEditQuestion={(key) => {
                setStartKey(key);
                navigate("/questions");
              }}
            />
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
              <Comparison onBack={() => navigate("/questions")} />
            </Suspense>
          </Route>

          <Route>
            <Redirect to={defaultRoute} replace />
          </Route>
        </Switch>
      </main>
    </ErrorBoundary>
  );
}

function NonAdminOnboarding({ status }: { status: GroupStatus; onDone?: () => void | Promise<void> }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setProfileMutation = useMutation(
    trpc.groups.setProfile.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }),
    }),
  );

  const showAnatomy = status.group.questionMode === "filtered" && status.group.anatomyPicker === "self";
  const anatomyLabelKey = (status.group.anatomyLabels ?? "anatomical") as AnatomyLabels;
  const labels = ANATOMY_LABEL_PRESETS[anatomyLabelKey];

  return (
    <OnboardingForm
      showAnatomy={showAnatomy}
      labels={labels}
      onSubmit={(name, anatomy) => setProfileMutation.mutate({ name, anatomy })}
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
        {/* Escape hatch back to editing. Navigates only — does NOT unmark
            completion state, so partners on /results aren't kicked out. Any
            new answers sync normally and propagate via the journal stream. */}
        <button type="button" onClick={() => navigate("/questions")} className="text-sm text-text-muted underline">
          Edit my answers
        </button>
        {status.person.isAdmin && (
          <button type="button" onClick={() => navigate("/invite")} className="text-sm text-text-muted block mx-auto">
            View group members
          </button>
        )}
      </div>
    </Card>
  );
}

function PickAnatomyScreen({ status }: { status: GroupStatus & { person: Person }; onDone?: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setProfileMutation = useMutation(
    trpc.groups.setProfile.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.groups.status.pathKey() }),
    }),
  );

  const anatomyLabelKey = (status.group.anatomyLabels ?? "anatomical") as AnatomyLabels;
  const labels = ANATOMY_LABEL_PRESETS[anatomyLabelKey];
  const [selected, setSelected] = useState<Anatomy | "">("");

  return (
    <Card>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">One quick thing</h1>
        <p className="text-text-muted">Pick your body type so we can show you relevant questions.</p>
        <AnatomyPicker selected={selected} onSelect={setSelected} labels={labels} />
        <Button
          fullWidth
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            setProfileMutation.mutate({ name: status.person.name, anatomy: selected });
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

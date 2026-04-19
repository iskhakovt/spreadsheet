import {
  ANATOMY_LABEL_PRESETS,
  type Anatomy,
  type AnatomyLabels,
  type CategoryData,
  type Group as GroupData,
  type GroupStatus,
  type Person,
  type QuestionData,
} from "@spreadsheet/shared";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Redirect, Route, Switch, useLocation, useParams } from "wouter";
import { AnatomyPicker } from "../components/AnatomyPicker.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { CopyMyLink } from "../components/copy-my-link.js";
import { handleError, MissingKeyScreen, ScreenErrorFallback } from "../components/ErrorFallback.js";
import { cn } from "../lib/cn.js";
import { getGroupKeyFromUrl } from "../lib/crypto.js";
import { JOURNAL_QUERY_KEY, prefetchJournal } from "../lib/journal-query.js";
import { sortMembersViewerFirst } from "../lib/member-display.js";
import { setSession } from "../lib/session.js";
import { getHasSeenIntro } from "../lib/storage.js";
import { useTRPC, useTRPCClient, wsClient } from "../lib/trpc.js";
import { useLiveStatus } from "../lib/use-live-status.js";
import { useMarkComplete } from "../lib/use-mark-complete.js";
import { Comparison } from "./Comparison.js";
import { Group } from "./Group.js";
import { GroupSetup } from "./GroupSetup.js";
import { Intro } from "./Intro.js";
import { Question } from "./Question.js";
import { Review } from "./Review.js";
import { Summary } from "./Summary.js";

// Status with `person` narrowed to non-null. PersonApp returns early above
// when `authedStatus.person === null` (admin token pre-setup path), so every
// downstream screen takes this narrowed shape.
type AuthedGroupStatus = Omit<GroupStatus, "person"> & { person: Person };

function resolveRoute(person: Person, group: GroupData, allComplete: boolean): string {
  if (!person.name) return "/setup";
  if (allComplete) return "/results";
  if (person.isCompleted) return "/waiting";
  if (person.isAdmin && !group.isAdminReady) return "/group";
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
  const trpcClient = useTRPCClient();
  const { data: questionsData } = useSuspenseQuery(trpcProxy.questions.list.queryOptions());

  // Pre-warm the Comparison cache the moment allComplete flips to true,
  // so the /results render doesn't have to wait for the HTTP fetch +
  // decryption on the critical path. This covers both sides of the
  // markComplete broadcast: the user who clicked (own mutation onSuccess
  // invalidates status → useLiveStatus refetches → allComplete flips) and
  // the partner (WS push → setQueryData → allComplete flips). By the time
  // the guard redirects to /results, the journal is either already in
  // cache or in flight.
  const allComplete = status && "members" in status ? status.members.every((m) => m.isCompleted) : false;
  useEffect(() => {
    if (allComplete && !queryClient.getQueryData(JOURNAL_QUERY_KEY)) {
      prefetchJournal(queryClient, trpcClient).catch((err) => console.error("Journal prefetch failed:", err));
    }
  }, [allComplete, queryClient, trpcClient]);
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

  // Single unified mark-complete flow — always flushes pending ops first.
  // See lib/use-mark-complete.ts for why this matters (orphaned-answers bug
  // when navigating `/questions → /summary → /review → Done`).
  const markComplete = useMarkComplete();

  // Self first, then others alphabetically by name. Memoized so the sort
  // only re-runs when the member list actually changes — `status.members`
  // is referentially stable across renders via TanStack cache and the
  // groups.status subscription's setQueryData. Computed unconditionally
  // (above the early returns) per the rules of hooks; the result is only
  // *used* in the authed branch where person is non-null.
  const sortedMembers = useMemo(
    () => sortMembersViewerFirst(status?.members ?? [], status?.person?.id ?? ""),
    [status?.members, status?.person?.id],
  );

  // Loading is handled by the top-level <Suspense> boundary in main.tsx
  // via useLiveStatus → useSuspenseQuery. Errors propagate to the nearest
  // ErrorBoundary (root fallback reloads the page; screen fallback retries
  // by resetting resetKeys). No per-hook loading/error state needed here.

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

  // Guard: encrypted group opened without the #key= fragment.
  // Prevents both unreadable encrypted data AND accidental plaintext writes.
  if (status.group.encrypted && !getGroupKeyFromUrl()) {
    return <MissingKeyScreen />;
  }

  // Admin token — group exists but no person yet
  if (!status.person) {
    return (
      <ErrorBoundary FallbackComponent={ScreenErrorFallback} onError={handleError} resetKeys={[location]}>
        <GroupSetup adminToken={token} group={status.group} />
      </ErrorBoundary>
    );
  }

  // TS narrows `status.person` to non-null via the guard above but doesn't
  // carry that narrow to the enclosing object, so when `status` gets passed
  // down the narrow is lost. Assert the whole object as `AuthedGroupStatus`
  // — safe here because the early return above rules out the null branch.
  const authedStatus = status as AuthedGroupStatus;

  const defaultRoute = resolveRoute(authedStatus.person, authedStatus.group, allComplete);

  // Universal guard: if current route doesn't match resolved state, redirect.
  // Freely-navigable routes are exempt. /questions is in the list because
  // marked-complete users can enter it via the "Edit my answers" buttons on
  // /waiting and /results without triggering an unmark mutation — they keep
  // their completion state, and any new writes land as journal appends that
  // propagate to partners via the sync.onJournalChange subscription.
  const freeRoutes = ["/group", "/summary", "/review", "/questions"];
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
            <NonAdminOnboarding status={authedStatus} />
          </Route>

          <Route path="/pending">
            <PendingScreen status={authedStatus} sortedMembers={sortedMembers} />
          </Route>

          <Route path="/group">
            <Group
              members={sortedMembers}
              person={authedStatus.person}
              group={authedStatus.group}
              onGroupReady={() => markReadyMutation.mutate()}
              onStartFilling={() => {
                if (!getHasSeenIntro()) navigate("/intro");
                else navigate("/questions");
              }}
              onViewAnswers={() => navigate("/review")}
              onBack={() => navigate("/summary")}
            />
          </Route>

          <Route path="/anatomy">
            <PickAnatomyScreen status={authedStatus} />
          </Route>

          <Route path="/intro">
            <Intro showTiming={authedStatus.group.showTiming} onDone={() => navigate("/questions")} />
          </Route>

          <Route path="/questions">
            <Question
              person={authedStatus.person}
              group={authedStatus.group}
              members={sortedMembers}
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
              isAdmin={authedStatus.person.isAdmin}
              onNavigateToCategory={(catId) => {
                setStartKey(`welcome:${catId}`);
                navigate("/questions");
              }}
              onBack={() => navigate("/questions")}
              onReview={() => navigate("/review")}
              onViewGroup={() => navigate("/group")}
            />
          </Route>

          <Route path="/review">
            <Review
              questions={questionsData.questions as QuestionData[]}
              categories={questionsData.categories as CategoryData[]}
              onMarkComplete={markComplete}
              onViewProgress={() => navigate("/summary")}
              onEditQuestion={(key) => {
                setStartKey(key);
                navigate("/questions");
              }}
              onBack={() => navigate("/summary")}
            />
          </Route>

          <Route path="/waiting">
            <WaitingScreen status={authedStatus} sortedMembers={sortedMembers} navigate={navigate} />
          </Route>

          <Route path="/results">
            <Comparison
              viewerId={authedStatus.person.id}
              showTiming={authedStatus.group.showTiming}
              encrypted={authedStatus.group.encrypted}
              onBack={() => navigate("/questions")}
            />
          </Route>

          <Route>
            <Redirect to={defaultRoute} replace />
          </Route>
        </Switch>
      </main>
    </ErrorBoundary>
  );
}

function NonAdminOnboarding({ status }: Readonly<{ status: GroupStatus }>) {
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

function PendingScreen({
  status,
  sortedMembers,
}: Readonly<{ status: AuthedGroupStatus; sortedMembers: GroupStatus["members"] }>) {
  const waitingForAnatomy = status.group.isAdminReady && !status.group.isReady;
  const others = sortedMembers.filter((m) => m.id !== status.person.id);

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
            <div
              key={m.id}
              className="flex items-center justify-between px-4 py-2.5 bg-surface/60 rounded-[var(--radius-sm)] border border-border/30 text-sm"
            >
              <span>{m.name}</span>
              {waitingForAnatomy && (
                <span className={cn("text-xs", m.anatomy ? "text-accent font-medium" : "text-text-muted/70")}>
                  {m.anatomy ? "Ready" : "Setting up..."}
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted/70">Only matches are revealed. Checking automatically...</p>
        <CopyMyLink encrypted={status.group.encrypted} />
      </div>
    </Card>
  );
}

function WaitingScreen({
  status,
  sortedMembers,
  navigate,
}: Readonly<{
  status: AuthedGroupStatus;
  sortedMembers: GroupStatus["members"];
  navigate: (to: string) => void;
}>) {
  const others = sortedMembers.filter((m) => m.id !== status.person.id);
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
            completion state, so partners on /results aren't kicked out. Any
            new answers sync normally and propagate via the journal stream. */}
        <button
          type="button"
          onClick={() => navigate("/questions")}
          className="text-sm text-text-muted/70 hover:text-accent transition-colors duration-200 underline underline-offset-2"
        >
          Edit my answers
        </button>
        {status.person.isAdmin && (
          <button
            type="button"
            onClick={() => navigate("/group")}
            className="text-sm text-text-muted/70 hover:text-accent transition-colors duration-200 block mx-auto"
          >
            View group members
          </button>
        )}
        <CopyMyLink encrypted={status.group.encrypted} />
      </div>
    </Card>
  );
}

function PickAnatomyScreen({ status }: Readonly<{ status: AuthedGroupStatus }>) {
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
}: Readonly<{
  showAnatomy: boolean;
  labels: Record<Anatomy, string>;
  onSubmit: (name: string, anatomy: string | null) => void;
}>) {
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
            className="w-full px-4 py-3.5 rounded-[var(--radius-md)] bg-surface/60 border border-border/40 text-text placeholder:text-text-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30 transition-all duration-200"
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

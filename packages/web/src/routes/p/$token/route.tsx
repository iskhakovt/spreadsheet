import type { CategoryData, Group as GroupData, Person, QuestionData } from "@spreadsheet/shared";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Card } from "../../../components/Card.js";
import {
  handleError,
  KeyMismatchScreen,
  MissingKeyScreen,
  ScreenErrorFallback,
} from "../../../components/ErrorFallback.js";
import { getGroupCodec } from "../../../lib/codec.js";
import { getGroupKeyFromUrl } from "../../../lib/crypto.js";
import { JOURNAL_QUERY_KEY, prefetchJournal } from "../../../lib/journal-query.js";
import { sortMembersViewerFirst } from "../../../lib/member-display.js";
import {
  type AuthedGroupStatus,
  PersonAppContext,
  type PersonAppContextValue,
  usePersonApp,
} from "../../../lib/person-app-context.js";
import { resolveRoute, shouldRedirectTo } from "../../../lib/resolve-route.js";
import { useSelfJournal } from "../../../lib/self-journal.js";
import { adoptSession, isPersonSwitch } from "../../../lib/session.js";
import { getHasSeenIntro } from "../../../lib/storage.js";
import { useTRPC, useTRPCClient } from "../../../lib/trpc.js";
import { useLiveStatus } from "../../../lib/use-live-status.js";
import { useMarkComplete } from "../../../lib/use-mark-complete.js";
import { useResealLegacyProfile } from "../../../lib/use-reseal-legacy-profile.js";
import { useTokenSwitchCleanup } from "../../../lib/use-token-switch-cleanup.js";
import { GroupSetup } from "../../../screens/GroupSetup.js";

export const Route = createFileRoute("/p/$token")({
  // adoptSession before any tRPC call so the session hash is in place. The
  // Zustand vanilla store works outside React so this is safe in a loader.
  // The server's /p/:token route has already set the httpOnly cookie on
  // this navigation; this just records which session this tab is on.
  //
  // One page = one person: a different person's link in this page reloads
  // instead of switching in place (see `isPersonSwitch`).
  loader: ({ params, preload }) => {
    // A preload (e.g. a future intent-preloading link) runs this loader
    // while the page is still on its current URL: no adopting, no reloading.
    if (preload) return;
    if (isPersonSwitch(params.token)) {
      reloadForPersonSwitch();
      return;
    }
    adoptSession(params.token);
  },
  component: PersonAppGate,
});

/**
 * Reload into the URL the router has already committed (/p/<other token>,
 * with its #key= fragment). A primitive on purpose: the router's own
 * `reloadDocument` navigation sets `location.href` to that same URL, which,
 * with a fragment, is a fragment-only navigation and doesn't reload.
 */
function reloadForPersonSwitch(): void {
  window.location.reload();
}

/** Renders nothing for a different person's link while the page reloads into it. */
function PersonAppGate() {
  const { token } = Route.useParams();
  const switching = isPersonSwitch(token);
  // The loader normally reloads first; this covers a render that beats it.
  useEffect(() => {
    if (switching) reloadForPersonSwitch();
  }, [switching]);
  return switching ? null : <PersonAppLayout />;
}

function PersonAppLayout() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Idempotent here (the loader adopted this token), but keeps the session
  // in place before any tRPC hook fires even if the loader hasn't run.
  adoptSession(token);

  useTokenSwitchCleanup(token);

  const { status, refresh: refreshStatus } = useLiveStatus();
  // Every seal/open in the app goes through this codec, built from the
  // group's own `encrypted` flag. It's inert until used, so building it
  // here is safe even when the key is missing (handled below).
  const codec = getGroupCodec(status?.group.encrypted ?? false);
  const trpcProxy = useTRPC();
  const trpcClient = useTRPCClient();
  const { data: questionsData } = useSuspenseQuery(trpcProxy.questions.list.queryOptions());

  const allComplete = status && "members" in status ? status.members.every((m) => m.isCompleted) : false;

  // Pre-warm the Comparison cache the moment allComplete flips so /results
  // renders without waiting for the HTTP fetch + decryption on the critical path.
  useEffect(() => {
    if (allComplete && !queryClient.getQueryData(JOURNAL_QUERY_KEY)) {
      prefetchJournal(queryClient, trpcClient, codec).catch((err) => console.error("Journal prefetch failed:", err));
    }
  }, [allComplete, queryClient, trpcClient, codec]);

  const [startKey, setStartKey] = useState<string | undefined>(undefined);

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: trpcProxy.groups.status.pathKey() });
  const markReadyMutation = useMutation(trpcProxy.groups.markReady.mutationOptions({ onSuccess: invalidateStatus }));
  const markComplete = useMarkComplete(token, codec);

  const sortedMembers = useMemo(
    () => sortMembersViewerFirst(status?.members ?? [], status?.person?.id ?? ""),
    [status?.members, status?.person?.id],
  );

  // Guard: compute whether the current child route matches what the status
  // dictates. Free routes are exempt — users reach them intentionally and
  // marked-complete users edit answers via /questions without unmarking —
  // except when a profile field needs recovering (/setup, /anatomy).
  const defaultRoute = status?.person
    ? resolveRoute(status.person as Person, status.group as GroupData, allComplete, getHasSeenIntro())
    : null;
  const routeSuffix = location.pathname.replace(`/p/${token}`, "") || "/";
  const shouldRedirect = shouldRedirectTo(routeSuffix, defaultRoute);

  // Real-time guard via useLayoutEffect so an SSE-triggered status change
  // (e.g. everyone completes → /results) redirects before paint.
  useLayoutEffect(() => {
    if (!shouldRedirect || !defaultRoute) return;
    void navigate({ to: `/p/$token${defaultRoute}` as string, params: { token }, replace: true });
  }, [shouldRedirect, defaultRoute, token, navigate]);

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

  if (status.group.encrypted && !getGroupKeyFromUrl()) {
    return <MissingKeyScreen />;
  }

  // A key on a plaintext group's link: the codec would refuse every seal
  // anyway, so say so up front instead of after someone fills in setup.
  if (!status.group.encrypted && getGroupKeyFromUrl()) {
    return <KeyMismatchScreen />;
  }

  if (!status.person) {
    return (
      <ErrorBoundary FallbackComponent={ScreenErrorFallback} onError={handleError} resetKeys={[location.pathname]}>
        <GroupSetup adminToken={token} group={status.group} />
      </ErrorBoundary>
    );
  }

  // Render nothing while the layout effect fires the redirect to avoid
  // briefly flashing the wrong child route.
  if (shouldRedirect) return null;

  const ctx: PersonAppContextValue = {
    token,
    authedStatus: status as AuthedGroupStatus,
    codec,
    sortedMembers,
    questionsData: questionsData as { questions: QuestionData[]; categories: CategoryData[] },
    markComplete,
    markReady: () => markReadyMutation.mutate(),
    refreshStatus,
    startKey,
    setStartKey,
  };

  // Backstop only: with one page = one person (`PersonAppGate`), a token
  // change reloads the page before this layout renders for it.
  //
  // `key={token}` on the inner subtree forces React to unmount and remount
  // the entire authed app when the URL token changes within the same tab.
  // This is the only reliable way to tear down active SSE subscriptions
  // — `useSubscription` only opens/closes its EventSource on mount/unmount
  // and on input changes, neither of which fire on a same-tab token switch.
  // Without this key, an open EventSource keeps streaming under the
  // previous session-key's `connectionParams` until the connection
  // naturally drops, and its `onData` would write the previous person's
  // data back into the freshly-reset cache.
  return (
    <PersonAppContext.Provider value={ctx}>
      <ErrorBoundary FallbackComponent={ScreenErrorFallback} onError={handleError} resetKeys={[location.pathname]}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-accent-fg focus:rounded-lg"
        >
          Skip to content
        </a>
        <main id="main-content" key={token}>
          <AuthedShell>
            <Outlet />
          </AuthedShell>
        </main>
      </ErrorBoundary>
    </PersonAppContext.Provider>
  );
}

/**
 * Inner shell rendered only after the auth + encryption gates have passed.
 * Owns the per-mount self-journal hydration: `useSelfJournal` suspense-
 * fetches the per-person journal delta, replays + decrypts, and merges
 * with the local outbox. Subsequent reads of `useAnswers` in the play
 * screens see the journal-derived state.
 *
 * Splitting this from `PersonAppLayout` keeps the suspense scope tight:
 * the hook can't fire during `/setup` (no person yet) or when the
 * encrypted-group fragment key is missing (handled by the early returns
 * in the parent).
 */
function AuthedShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const { codec } = usePersonApp();
  useSelfJournal(codec);
  useResealLegacyProfile();
  return <>{children}</>;
}

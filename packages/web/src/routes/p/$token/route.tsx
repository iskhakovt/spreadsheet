import type { CategoryData, Group as GroupData, Person, QuestionData } from "@spreadsheet/shared";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Card } from "../../../components/Card.js";
import { handleError, MissingKeyScreen, ScreenErrorFallback } from "../../../components/ErrorFallback.js";
import { getGroupKeyFromUrl } from "../../../lib/crypto.js";
import { JOURNAL_QUERY_KEY, prefetchJournal } from "../../../lib/journal-query.js";
import { sortMembersViewerFirst } from "../../../lib/member-display.js";
import {
  type AuthedGroupStatus,
  PersonAppContext,
  type PersonAppContextValue,
} from "../../../lib/person-app-context.js";
import { adoptSession } from "../../../lib/session.js";
import { getHasSeenIntro } from "../../../lib/storage.js";
import { useTRPC, useTRPCClient, wsClient } from "../../../lib/trpc.js";
import { useLiveStatus } from "../../../lib/use-live-status.js";
import { useMarkComplete } from "../../../lib/use-mark-complete.js";
import { GroupSetup } from "../../../screens/GroupSetup.js";

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

export const Route = createFileRoute("/p/$token")({
  // adoptSession before any tRPC call so the session hash is in place. The
  // Zustand vanilla store works outside React so this is safe in a loader.
  // The server's /p/:token route has already set the httpOnly cookie on
  // this navigation; this just records which session this tab is on.
  loader: ({ params }) => {
    adoptSession(params.token);
  },
  component: PersonAppLayout,
});

function PersonAppLayout() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // adoptSession again in the component for the token-change case (useEffect
  // below closes the WS; adoptSession re-establishes the auth scope for the
  // new token so tRPC hooks pick up the right credentials on next render).
  adoptSession(token);

  // On in-tab navigation between two /p/:token URLs: close WS for a clean
  // auth handshake and drop any non-token-keyed cache entries.
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

  const allComplete = status && "members" in status ? status.members.every((m) => m.isCompleted) : false;

  // Pre-warm the Comparison cache the moment allComplete flips so /results
  // renders without waiting for the HTTP fetch + decryption on the critical path.
  useEffect(() => {
    if (allComplete && !queryClient.getQueryData(JOURNAL_QUERY_KEY)) {
      prefetchJournal(queryClient, trpcClient).catch((err) => console.error("Journal prefetch failed:", err));
    }
  }, [allComplete, queryClient, trpcClient]);

  const [startKey, setStartKey] = useState<string | undefined>(undefined);

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: trpcProxy.groups.status.pathKey() });
  const markReadyMutation = useMutation(trpcProxy.groups.markReady.mutationOptions({ onSuccess: invalidateStatus }));
  const markComplete = useMarkComplete(token);

  const sortedMembers = useMemo(
    () => sortMembersViewerFirst(status?.members ?? [], status?.person?.id ?? ""),
    [status?.members, status?.person?.id],
  );

  // Guard: compute whether the current child route matches what the status
  // dictates. freeRoutes are exempt — users reach them intentionally and
  // marked-complete users edit answers via /questions without unmarking.
  const defaultRoute = status?.person
    ? resolveRoute(status.person as Person, status.group as GroupData, allComplete)
    : null;
  const freeRoutes = ["/group", "/summary", "/review", "/questions"];
  const routeSuffix = location.pathname.replace(`/p/${token}`, "") || "/";
  const shouldRedirect = !!defaultRoute && routeSuffix !== defaultRoute && !freeRoutes.includes(routeSuffix);

  // Real-time guard via useLayoutEffect so a WS-triggered status change
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
    sortedMembers,
    questionsData: questionsData as { questions: QuestionData[]; categories: CategoryData[] },
    markComplete,
    markReady: () => markReadyMutation.mutate(),
    refreshStatus,
    startKey,
    setStartKey,
  };

  return (
    <PersonAppContext.Provider value={ctx}>
      <ErrorBoundary FallbackComponent={ScreenErrorFallback} onError={handleError} resetKeys={[location.pathname]}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-accent-fg focus:rounded-lg"
        >
          Skip to content
        </a>
        <main id="main-content">
          <Outlet />
        </main>
      </ErrorBoundary>
    </PersonAppContext.Provider>
  );
}

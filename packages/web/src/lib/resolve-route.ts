import type { Group, Person } from "@spreadsheet/shared";

/** Screens people reach on purpose; the guard doesn't pull them away from these. */
export const FREE_ROUTES: readonly string[] = ["/group", "/summary", "/review", "/questions"];

/**
 * Screens that recover a missing profile field. They win over free routes
 * and over completion: a name or anatomy that didn't open (or was never set)
 * has to be entered again before anything else makes sense.
 */
export const RECOVERY_ROUTES: readonly string[] = ["/setup", "/anatomy"];

/** The screen the person's status calls for, relative to `/p/$token`. */
export function resolveRoute(
  person: Pick<Person, "name" | "anatomy" | "isAdmin" | "isCompleted">,
  group: Pick<Group, "isReady" | "isAdminReady" | "questionMode">,
  allComplete: boolean,
  hasSeenIntro: boolean,
): string {
  if (!person.name) return "/setup";
  if (group.questionMode === "filtered" && group.isAdminReady && person.anatomy === null) return "/anatomy";
  if (allComplete) return "/results";
  if (person.isCompleted) return "/waiting";
  if (person.isAdmin && !group.isAdminReady) return "/group";
  if (!group.isAdminReady && !person.isAdmin) return "/pending";
  if (!group.isReady) return "/pending";
  if (!hasSeenIntro) return "/intro";
  return "/questions";
}

/** Whether the guard should redirect from `routeSuffix` to `defaultRoute`. */
export function shouldRedirectTo(routeSuffix: string, defaultRoute: string | null): boolean {
  if (!defaultRoute || routeSuffix === defaultRoute) return false;
  return RECOVERY_ROUTES.includes(defaultRoute) || !FREE_ROUTES.includes(routeSuffix);
}

import type { Answer } from "@spreadsheet/shared";
import { getScope } from "./session.js";

function getJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(getScope() + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setJson(key: string, value: unknown): void {
  localStorage.setItem(getScope() + key, JSON.stringify(value));
}

function getRaw(key: string): string | null {
  return localStorage.getItem(getScope() + key);
}

function setRaw(key: string, value: string): void {
  localStorage.setItem(getScope() + key, value);
}

function removeRaw(key: string): void {
  localStorage.removeItem(getScope() + key);
}

export function getStoken(): string | null {
  return getRaw("stoken");
}

export function setStoken(stoken: string | null): void {
  if (stoken) {
    setRaw("stoken", stoken);
  } else {
    removeRaw("stoken");
  }
}

export function getAnswers(): Record<string, Answer> {
  return getJson("answers", {});
}

export function setAnswers(answers: Record<string, Answer>): void {
  setJson("answers", answers);
}

export function setAnswer(key: string, answer: Answer | null): void {
  const answers = getAnswers();
  if (answer === null) {
    delete answers[key];
  } else {
    answers[key] = answer;
  }
  setAnswers(answers);
}

export function getPendingOps(): string[] {
  return getJson("pendingOps", []);
}

export function setPendingOps(ops: string[]): void {
  setJson("pendingOps", ops);
}

export function addPendingOp(op: string): void {
  const ops = getPendingOps();
  ops.push(op);
  setPendingOps(ops);
}

export function clearPendingOps(): void {
  removeRaw("pendingOps");
}

export function getSelectedCategories(): string[] | null {
  return getJson("selectedCategories", null);
}

export function setSelectedCategories(categories: string[]): void {
  setJson("selectedCategories", categories);
}

export function getSelectedTier(): number {
  const raw = getRaw("selectedTier");
  if (raw) {
    const n = Number(raw);
    if (n >= 1 && n <= 3) return n;
  }
  return 2;
}

export function setSelectedTier(tier: number): void {
  setRaw("selectedTier", String(tier));
}

export function getHasSeenIntro(): boolean {
  return getRaw("hasSeenIntro") === "true";
}

export function setHasSeenIntro(): void {
  setRaw("hasSeenIntro", "true");
}

export function getCurrentScreenKey(): string | null {
  return getRaw("currentScreen");
}

export function setCurrentScreenKey(key: string): void {
  setRaw("currentScreen", key);
}

/** Get the cached auth token (set after a successful claim or setupAdmin). */
export function getStoredAuthToken(): string | null {
  return getRaw("authToken");
}

/** Cache the auth token in localStorage so subsequent page loads skip the claim call. */
export function setStoredAuthToken(authToken: string): void {
  setRaw("authToken", authToken);
}

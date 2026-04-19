import type { Answer } from "@spreadsheet/shared";
import { useSyncExternalStore } from "react";
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

// React-side reads of localStorage-backed state go through useSyncExternalStore
// so they get stable object identity. Non-React callers keep using the
// imperative getters — they don't need stable identity.

// Snapshot cache keyed by full localStorage key (scope + suffix), so session
// changes in-tab don't cross-contaminate.
const snapshotCache = new Map<string, { raw: string | null; parsed: unknown }>();

function readCachedSnapshot<T>(suffix: string, parse: (raw: string | null) => T): T {
  const fullKey = getScope() + suffix;
  const raw = localStorage.getItem(fullKey);
  const cached = snapshotCache.get(fullKey);
  if (cached && cached.raw === raw) return cached.parsed as T;
  // Self-heal on corrupt storage (manual edits, partial writes): fall back
  // to parse(null). Cache the raw alongside the fallback so subsequent
  // reads short-circuit to the cached value instead of re-throwing.
  let parsed: T;
  try {
    parsed = parse(raw);
  } catch {
    parsed = parse(null);
  }
  snapshotCache.set(fullKey, { raw, parsed });
  return parsed;
}

function notifyChanged(suffix: string): void {
  snapshotCache.delete(getScope() + suffix);
  // `window` guard for the node-env unit tests that exercise setters.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(`storage:${suffix}`));
  }
}

// === answers ===

function answersSubscribe(callback: () => void): () => void {
  function onStorage(e: StorageEvent) {
    if (e.key === getScope() + "answers") callback();
  }
  function onLocal() {
    callback();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener("storage:answers", onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("storage:answers", onLocal);
  };
}

function answersSnapshot(): Record<string, Answer> {
  return readCachedSnapshot("answers", (raw) => (raw ? JSON.parse(raw) : {}));
}

export function useAnswers(): Record<string, Answer> {
  return useSyncExternalStore(answersSubscribe, answersSnapshot);
}

export function getAnswers(): Record<string, Answer> {
  return getJson("answers", {});
}

export function setAnswers(answers: Record<string, Answer>): void {
  setJson("answers", answers);
  notifyChanged("answers");
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

// === pendingOps ===

function pendingOpsSubscribe(callback: () => void): () => void {
  function onStorage(e: StorageEvent) {
    if (e.key === getScope() + "pendingOps") callback();
  }
  function onLocal() {
    callback();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener("storage:pendingOps", onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("storage:pendingOps", onLocal);
  };
}

function pendingOpsSnapshot(): string[] {
  return readCachedSnapshot("pendingOps", (raw) => (raw ? JSON.parse(raw) : []));
}

export function usePendingOps(): string[] {
  return useSyncExternalStore(pendingOpsSubscribe, pendingOpsSnapshot);
}

export function getPendingOps(): string[] {
  return getJson("pendingOps", []);
}

export function setPendingOps(ops: string[]): void {
  setJson("pendingOps", ops);
  notifyChanged("pendingOps");
}

export function addPendingOp(op: string): void {
  const ops = getPendingOps();
  ops.push(op);
  setPendingOps(ops);
}

export function clearPendingOps(): void {
  removeRaw("pendingOps");
  notifyChanged("pendingOps");
}

// === stoken ===

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

// === selectedCategories / selectedTier ===
// Wrapped in component-level useState, so no useSyncExternalStore hook.

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

// === one-shot flags / cursors ===

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

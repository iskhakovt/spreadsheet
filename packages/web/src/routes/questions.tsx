import { createFileRoute } from "@tanstack/react-router";
import { QuestionsBrowser } from "../screens/QuestionsBrowser.js";

/**
 * Free public route — the question-bank browser. No auth, no token; intended
 * as marketing/transparency surface ("see what we'd ask before signing up")
 * and as a debugging inspector for the curated `requires` graph.
 *
 * `head.meta` adds `<meta name="robots" content="noindex">` so the URL
 * exists without ranking for it. The page is otherwise a normal SPA route
 * — Suspense in __root.tsx handles the questions.list loading state.
 */
export const Route = createFileRoute("/questions")({
  component: QuestionsBrowser,
  head: () => ({
    meta: [{ title: "Questions · Spreadsheet" }, { name: "robots", content: "noindex" }],
  }),
});

import { createFileRoute } from "@tanstack/react-router";
import { Results } from "../../../screens/Results.js";

export const Route = createFileRoute("/p/$token/results")({
  component: Results,
});

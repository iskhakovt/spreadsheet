import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "../screens/Landing.js";

export const Route = createFileRoute("/")({
  component: Landing,
});

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { Comparison } from "../../../screens/Comparison.js";

export const Route = createFileRoute("/p/$token/results")({
  component: ResultsRoute,
});

function ResultsRoute() {
  const { token, authedStatus } = usePersonApp();
  const navigate = useNavigate();

  return (
    <Comparison
      viewerId={authedStatus.person.id}
      showTiming={authedStatus.group.showTiming}
      encrypted={authedStatus.group.encrypted}
      onBack={() => void navigate({ to: "/p/$token/questions", params: { token } })}
    />
  );
}

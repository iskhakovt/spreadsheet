import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { useTRPC } from "../../../lib/trpc.js";
import { Comparison } from "../../../screens/Comparison.js";

export const Route = createFileRoute("/p/$token/results")({
  component: ResultsRoute,
});

function ResultsRoute() {
  const { token, authedStatus } = usePersonApp();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const { mutate: trackEvent } = useMutation(trpc.analytics.track.mutationOptions());

  useEffect(() => {
    trackEvent({ event: "results_viewed" });
  }, [trackEvent]);

  return (
    <Comparison
      viewerId={authedStatus.person.id}
      showTiming={authedStatus.group.showTiming}
      encrypted={authedStatus.group.encrypted}
      onBack={() => void navigate({ to: "/p/$token/questions", params: { token } })}
    />
  );
}

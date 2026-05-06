import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { usePersonApp } from "../lib/person-app-context.js";
import { useTRPC } from "../lib/trpc.js";
import { Comparison } from "./Comparison.js";

export function Results() {
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
      encrypted={authedStatus.group.encrypted}
      token={token}
      onBack={() => void navigate({ to: "/p/$token/questions", params: { token } })}
    />
  );
}

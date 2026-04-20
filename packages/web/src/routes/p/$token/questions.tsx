import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { Question } from "../../../screens/Question.js";

export const Route = createFileRoute("/p/$token/questions")({
  component: QuestionsRoute,
});

function QuestionsRoute() {
  const { token, authedStatus, sortedMembers, refreshStatus, startKey, setStartKey } = usePersonApp();
  const navigate = useNavigate();

  return (
    <Question
      person={authedStatus.person}
      group={authedStatus.group}
      members={sortedMembers}
      onDone={refreshStatus}
      onSummary={() => void navigate({ to: "/p/$token/summary", params: { token } })}
      startKey={startKey}
      onStartKeyConsumed={() => setStartKey(undefined)}
    />
  );
}

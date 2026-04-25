import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { getHasSeenIntro } from "../../../lib/storage.js";
import { Group } from "../../../screens/Group.js";

export const Route = createFileRoute("/p/$token/group")({
  component: GroupRoute,
});

function GroupRoute() {
  const { token, authedStatus, sortedMembers, markReady } = usePersonApp();
  const navigate = useNavigate();

  return (
    <Group
      members={sortedMembers}
      person={authedStatus.person}
      group={authedStatus.group}
      onGroupReady={markReady}
      onStartFilling={() => {
        if (!getHasSeenIntro()) void navigate({ to: "/p/$token/intro", params: { token } });
        else void navigate({ to: "/p/$token/questions", params: { token } });
      }}
      onViewAnswers={() => void navigate({ to: "/p/$token/review", params: { token } })}
      onBack={() => void navigate({ to: "/p/$token/summary", params: { token } })}
    />
  );
}

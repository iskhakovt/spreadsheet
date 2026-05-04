import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePersonApp } from "../../../lib/person-app-context.js";
import { Intro } from "../../../screens/Intro.js";

export const Route = createFileRoute("/p/$token/intro")({
  component: IntroRoute,
});

function IntroRoute() {
  const { token } = usePersonApp();
  const navigate = useNavigate();

  return <Intro onDone={() => void navigate({ to: "/p/$token/questions", params: { token } })} />;
}

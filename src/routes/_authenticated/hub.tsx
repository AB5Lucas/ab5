import { createFileRoute, redirect } from "@tanstack/react-router";

// O HUB virou a visão geral do módulo Atividades; o endereço antigo continua funcionando.
export const Route = createFileRoute("/_authenticated/hub")({
  beforeLoad: () => { throw redirect({ to: "/atividades", replace: true }); },
});

import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
      <div>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function ComingSoon({ phase }: { phase: string }) {
  return (
    <div className="panel mt-6 flex flex-col items-center justify-center gap-2 p-10 text-center">
      <p className="font-display text-lg uppercase tracking-wide">Módulo em construção</p>
      <p className="max-w-md text-sm text-muted-foreground">
        Este módulo faz parte da {phase}. A base de dados já está criada e pronta para receber esta
        tela na próxima etapa de implementação.
      </p>
    </div>
  );
}

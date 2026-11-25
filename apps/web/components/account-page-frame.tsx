import type { ReactNode } from 'react';

type AccountPageFrameProps = {
  overline?: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children: ReactNode;
};

export function AccountPageFrame({
  overline,
  title,
  description,
  action,
  children,
}: AccountPageFrameProps) {
  return (
    <div className="flex flex-col gap-8 py-10 md:py-12">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          {overline ? (
            <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              {overline}
            </p>
          ) : null}
          <h1 className="font-extrabold text-3xl tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="max-w-prose text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

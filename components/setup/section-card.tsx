import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The one card shape every setup panel uses.
 *
 * Kept as a wrapper rather than repeating CardHeader/CardTitle in five files,
 * so a change to the panel chrome is a change to one file.
 */
export function SectionCard({
  title,
  description,
  icon,
  actions,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-foreground">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          {title}
        </CardTitle>
        {description ? (
          <CardDescription className="text-muted-foreground">
            {description}
          </CardDescription>
        ) : null}
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

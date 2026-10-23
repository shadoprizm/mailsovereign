import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { MailLabel } from "./types";

const colorClasses: Record<MailLabel["color"], string> = {
  slate:
    "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300",
  blue: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  violet:
    "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  green:
    "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-300",
  amber:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  red: "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
};

export function MailLabelBadge({
  className,
  label
}: {
  className?: string;
  label: Pick<MailLabel, "color" | "name">;
}): React.ReactElement {
  return (
    <Badge className={cn("font-normal", colorClasses[label.color], className)} variant="outline">
      {label.name}
    </Badge>
  );
}

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  parsing: "Parsing",
  drafting: "Drafting",
  validating: "Validating",
  ready: "Ready",
  needs_review: "Needs Review",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  parsing: "bg-secondary text-secondary-foreground",
  drafting: "bg-secondary text-secondary-foreground",
  validating: "bg-secondary text-secondary-foreground",
  ready: "bg-emerald-100 text-emerald-900 border-emerald-200",
  needs_review: "bg-amber-100 text-amber-900 border-amber-200",
  sending: "bg-secondary text-secondary-foreground",
  sent: "bg-primary text-primary-foreground",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      data-testid={`badge-status-${status}`}
      className={cn("border font-medium", STATUS_TONE[status] ?? "bg-muted text-muted-foreground")}
    >
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

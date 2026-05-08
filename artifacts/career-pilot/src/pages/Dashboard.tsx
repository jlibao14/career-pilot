import { Link } from "wouter";
import { useGetDashboardSummary, useListApplications } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowRight, FilePlus2, MailCheck, AlertCircle, FileText, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: applications, isLoading: appsLoading } = useListApplications();

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground mb-2">
            Mission control
          </p>
          <h1 className="font-serif text-4xl font-medium text-foreground">
            Good morning. Let's get you in front of the right people.
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Career Pilot reads each posting, drafts a tailored letter, runs a quality gate,
            and sends from your inbox once everything passes.
          </p>
        </div>
        <Button asChild size="lg" data-testid="button-new-application">
          <Link href="/new">
            <FilePlus2 className="w-4 h-4 mr-2" />
            New Application
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-4 gap-4">
        <SummaryTile label="Total" value={summary?.total} loading={summaryLoading} icon={<FileText className="w-4 h-4" />} />
        <SummaryTile label="Sent" value={summary?.sent} loading={summaryLoading} icon={<MailCheck className="w-4 h-4 text-emerald-700" />} />
        <SummaryTile label="Needs Review" value={summary?.needsReview} loading={summaryLoading} icon={<AlertCircle className="w-4 h-4 text-amber-700" />} />
        <SummaryTile label="Failed" value={summary?.failed} loading={summaryLoading} icon={<XCircle className="w-4 h-4 text-destructive" />} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-serif text-xl font-medium">Recent applications</h2>
          {applications && applications.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {applications.length} total
            </span>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            {appsLoading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : !applications || applications.length === 0 ? (
              <div className="p-12 text-center">
                <div className="font-serif text-lg text-foreground mb-1">
                  No applications yet
                </div>
                <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
                  Paste a job URL or job description and Career Pilot will take it from there.
                </p>
                <Button asChild>
                  <Link href="/new">Draft your first application</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {applications.map((app) => (
                  <li key={app.id}>
                    <Link
                      href={`/applications/${app.id}`}
                      data-testid={`row-application-${app.id}`}
                      className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <div className="font-medium text-foreground truncate">
                            {app.roleTitle || <span className="text-muted-foreground italic">Untitled role</span>}
                          </div>
                          <StatusBadge status={app.status} />
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {app.company || "Unknown company"}
                          {app.recipientEmail ? <> · <span className="font-mono text-xs">{app.recipientEmail}</span></> : null}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  loading,
  icon,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Card data-testid={`tile-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="mt-2 font-serif text-3xl font-medium text-foreground">
          {loading ? <Skeleton className="h-8 w-12" /> : (value ?? 0)}
        </div>
      </CardContent>
    </Card>
  );
}

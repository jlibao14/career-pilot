import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetApplication,
  useUpdateApplicationLetter,
  useUpdateApplicationRecipient,
  useSendApplication,
  useDeleteApplication,
  useProcessApplication,
  getGetApplicationQueryKey,
  getListApplicationsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, CheckCircle2, XCircle, Send, Trash2, RefreshCw, MapPin, Building2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function ApplicationDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: app, isLoading } = useGetApplication(id, {
    query: {
      refetchInterval: (q: { state: { data?: { status?: string } } }) => {
        const status = q.state.data?.status;
        return status && ["parsing", "drafting", "validating", "sending"].includes(status) ? 1500 : false;
      },
    } as never,
  });

  const updateLetter = useUpdateApplicationLetter();
  const updateRecipient = useUpdateApplicationRecipient();
  const sendApp = useSendApplication();
  const deleteApp = useDeleteApplication();
  const reprocess = useProcessApplication();

  const [letterDraft, setLetterDraft] = useState("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientName, setRecipientName] = useState("");

  useEffect(() => {
    if (app) {
      setLetterDraft(app.coverLetter ?? "");
      setSubjectDraft(app.emailSubject ?? "");
      setRecipient(app.recipientEmail ?? "");
      setRecipientName(app.recipientName ?? "");
    }
  }, [app?.id, app?.coverLetter, app?.emailSubject, app?.recipientEmail, app?.recipientName]);

  if (isLoading || !app) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  };

  const saveLetter = async () => {
    try {
      await updateLetter.mutateAsync({
        id,
        data: { coverLetter: letterDraft, emailSubject: subjectDraft },
      });
      invalidate();
      toast.success("Letter saved and re-validated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const saveRecipient = async () => {
    if (!recipient.trim()) {
      toast.error("Recipient email is required.");
      return;
    }
    try {
      await updateRecipient.mutateAsync({
        id,
        data: { recipientEmail: recipient.trim(), recipientName: recipientName.trim() || null },
      });
      invalidate();
      toast.success("Recipient updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const send = async () => {
    try {
      await sendApp.mutateAsync({ id });
      invalidate();
      toast.success("Sent.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    }
  };

  const remove = async () => {
    try {
      await deleteApp.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast.success("Deleted.");
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const redo = async () => {
    try {
      await reprocess.mutateAsync({ id });
      invalidate();
      toast.success("Redrafted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reprocess");
    }
  };

  const isProcessing = ["parsing", "drafting", "validating", "sending"].includes(app.status);
  const validationPassed = app.validation?.passed ?? false;

  return (
    <div className="space-y-8">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
        <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
      </Link>

      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <StatusBadge status={app.status} />
            {app.sentAt && (
              <span className="text-xs text-muted-foreground">
                Sent {format(new Date(app.sentAt), "PPP 'at' p")}
              </span>
            )}
          </div>
          <h1 className="font-serif text-3xl font-medium" data-testid="text-role-title">
            {app.roleTitle || "Untitled role"}
          </h1>
          <div className="flex items-center gap-4 text-muted-foreground mt-2 text-sm">
            {app.company && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> {app.company}
              </span>
            )}
            {app.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> {app.location}
              </span>
            )}
            {app.sourceUrl && (
              <a href={app.sourceUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-foreground">
                <ExternalLink className="w-3.5 h-3.5" /> Source
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={redo} disabled={reprocess.isPending || isProcessing} data-testid="button-redraft">
            {reprocess.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Redraft
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-delete">
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this application?</AlertDialogTitle>
                <AlertDialogDescription>
                  The draft letter and history will be removed. The email itself, if already sent, cannot be recalled.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {isProcessing && (
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <div>
              <div className="font-medium">Working on this application…</div>
              <div className="text-sm text-muted-foreground">
                Currently {app.status}. This page will update automatically.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {app.errorMessage && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-destructive">Something went wrong</div>
              <div className="text-sm text-muted-foreground mt-0.5">{app.errorMessage}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-serif text-lg font-medium">Cover letter</h2>
                  <span className="text-xs text-muted-foreground">
                    {letterDraft.split(/\s+/).filter(Boolean).length} words
                  </span>
                </div>
                <Textarea
                  value={letterDraft}
                  onChange={(e) => setLetterDraft(e.target.value)}
                  rows={18}
                  className="font-serif text-base leading-relaxed"
                  placeholder="The drafted letter will appear here once processing completes."
                  data-testid="textarea-letter"
                />
              </div>

              <div>
                <Label htmlFor="subject" className="text-sm">Email subject</Label>
                <Input
                  id="subject"
                  value={subjectDraft}
                  onChange={(e) => setSubjectDraft(e.target.value)}
                  className="mt-1.5"
                  data-testid="input-subject"
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={saveLetter} disabled={updateLetter.isPending} variant="outline" data-testid="button-save-letter">
                  {updateLetter.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                  Save changes
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <h3 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">Recipient</h3>
                <div className="space-y-2">
                  <Input
                    placeholder="recruiter@company.com"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    data-testid="input-recipient-email"
                  />
                  <Input
                    placeholder="Recipient name (optional)"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    data-testid="input-recipient-name"
                  />
                  <Button onClick={saveRecipient} variant="outline" size="sm" className="w-full" disabled={updateRecipient.isPending} data-testid="button-save-recipient">
                    Save recipient
                  </Button>
                </div>
              </div>

              <Button
                onClick={send}
                disabled={sendApp.isPending || isProcessing}
                size="lg"
                className="w-full"
                data-testid="button-send"
              >
                {sendApp.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {app.status === "sent" ? "Resend" : "Send via AgentMail"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h3 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-3">
                Validation gate {validationPassed && <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-700 ml-1" />}
              </h3>
              {!app.validation ? (
                <p className="text-sm text-muted-foreground">No checks run yet.</p>
              ) : (
                <ul className="space-y-2">
                  {app.validation.checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-2 text-sm" data-testid={`check-${check.id}`}>
                      {check.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{check.label}</div>
                        {check.detail && (
                          <div className="text-xs text-muted-foreground mt-0.5">{check.detail}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {app.keyRequirements && app.keyRequirements.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <h3 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">
                  Key requirements
                </h3>
                <ul className="space-y-1.5 text-sm text-foreground">
                  {app.keyRequirements.map((req, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">·</span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {app.jobSummary && (
            <Card>
              <CardContent className="p-5">
                <h3 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">
                  Role summary
                </h3>
                <p className="text-sm text-foreground/80 leading-relaxed">{app.jobSummary}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

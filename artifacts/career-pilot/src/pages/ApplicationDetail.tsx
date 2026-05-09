import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQueryClient, type Query } from "@tanstack/react-query";
import type { Application } from "@workspace/api-client-react";
import {
  useGetApplication,
  useUpdateApplicationLetter,
  useUpdateApplicationRecipient,
  useSendApplication,
  useDeleteApplication,
  useProcessApplication,
  useDraftApplication,
  useAutoCorrectApplication,
  useCommitAutoCorrect,
  getGetApplicationQueryKey,
  getListApplicationsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import type { AutoCorrectResult } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, CheckCircle2, XCircle, Send, Trash2, RefreshCw, MapPin, Building2, ExternalLink, Loader2, Sparkles, Wand2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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
      queryKey: getGetApplicationQueryKey(id),
      refetchInterval: (query: Query<Application>) => {
        const status = query.state.data?.status;
        return status && ["parsing", "drafting", "validating", "sending"].includes(status)
          ? 1500
          : false;
      },
    },
  });

  const updateLetter = useUpdateApplicationLetter();
  const updateRecipient = useUpdateApplicationRecipient();
  const sendApp = useSendApplication();
  const deleteApp = useDeleteApplication();
  const reprocess = useProcessApplication();
  const draft = useDraftApplication();
  const autoCorrect = useAutoCorrectApplication();
  const commitAutoCorrect = useCommitAutoCorrect();
  const [autoFixPreview, setAutoFixPreview] = useState<AutoCorrectResult | null>(null);
  const [autoFixOpen, setAutoFixOpen] = useState(false);

  const [letterDraft, setLetterDraft] = useState("");
  const [subjectDraft, setSubjectDraft] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [companyDraft, setCompanyDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("");

  useEffect(() => {
    if (app) {
      setLetterDraft(app.coverLetter ?? "");
      setSubjectDraft(app.emailSubject ?? "");
      setRecipient(app.recipientEmail ?? "");
      setRecipientName(app.recipientName ?? "");
      setCompanyDraft(app.company ?? "");
      setRoleDraft(app.roleTitle ?? "");
    }
  }, [
    app?.id,
    app?.coverLetter,
    app?.emailSubject,
    app?.recipientEmail,
    app?.recipientName,
    app?.company,
    app?.roleTitle,
  ]);

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
        data: {
          recipientEmail: recipient.trim(),
          recipientName: recipientName.trim() || null,
          company: companyDraft.trim() || null,
          roleTitle: roleDraft.trim() || null,
        },
      });
      invalidate();
      toast.success("Details updated.");
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
  const hasLetter = !!app.coverLetter;
  const canDraft = !!(app.company || app.roleTitle || app.sourceText || app.sourceUrl);

  const AUTO_CORRECTABLE = new Set([
    "word_count", "paragraph_structure", "no_placeholders", "subject_present", "grammar_spelling",
  ]);
  const NON_CORRECTABLE_HINTS: Record<string, string> = {
    recipient_email: "Edit the recipient email in Job details on the right.",
    company_role: "Add the company and role in Job details on the right.",
    resume_attached: "Upload a master resume in Settings.",
  };
  const failedAutoChecks =
    app.validation?.checks.filter((c) => !c.passed && AUTO_CORRECTABLE.has(c.id)) ?? [];
  const canAutoFix = hasLetter && failedAutoChecks.length > 0 && !isProcessing;

  const runAutoFix = async () => {
    try {
      const preview = await autoCorrect.mutateAsync({ id });
      setAutoFixPreview(preview);
      setAutoFixOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Auto-fix failed";
      toast.error(msg);
    }
  };

  const applyAutoFix = async () => {
    if (!autoFixPreview) return;
    try {
      const updated = await updateLetter.mutateAsync({
        id,
        data: {
          coverLetter: autoFixPreview.coverLetter,
          emailSubject: autoFixPreview.emailSubject,
        },
      });
      const targeted = autoFixPreview.targetedCheckIds;
      const targetedChecks = updated.validation?.checks.filter((c) => targeted.includes(c.id)) ?? [];
      const nowPassing = targetedChecks.filter((c) => c.passed).map((c) => c.label);
      const stillFailing = targetedChecks.filter((c) => !c.passed).map((c) => c.label);

      try {
        await commitAutoCorrect.mutateAsync({ id });
      } catch (commitErr) {
        // Letter already persisted; don't block the user — surface a clear warning.
        toast.warning("Changes applied, but history wasn't recorded.");
        setAutoFixOpen(false);
        setAutoFixPreview(null);
        invalidate();
        return;
      }

      setAutoFixOpen(false);
      setAutoFixPreview(null);
      invalidate();
      if (stillFailing.length === 0) {
        toast.success(
          nowPassing.length > 0
            ? `Auto-fix applied. Now passing: ${nowPassing.join(", ")}.`
            : "Auto-fix applied.",
        );
      } else {
        toast.warning(`Applied, but still failing: ${stillFailing.join(", ")}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to apply auto-fix");
    }
  };

  const wordCountOf = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  const paragraphCountOf = (s: string) =>
    s.split(/\n\s*\n+/).map((p) => p.trim()).filter((p) => p.length > 0).length;

  const generate = async () => {
    try {
      await draft.mutateAsync({ id });
      invalidate();
      toast.success("Cover letter drafted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to draft");
    }
  };

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
                {!hasLetter && canDraft && !isProcessing ? (
                  <div className="border border-dashed border-border rounded-md p-8 text-center">
                    <Sparkles className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                    <div className="font-medium">Ready to draft</div>
                    <p className="text-sm text-muted-foreground mt-1 mb-4">
                      Review the parsed details on the right, then generate a tailored letter.
                    </p>
                    <Button onClick={generate} disabled={draft.isPending} data-testid="button-generate">
                      {draft.isPending ? (
                        <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Drafting…</>
                      ) : (
                        <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Generate cover letter</>
                      )}
                    </Button>
                  </div>
                ) : (
                  <Textarea
                    value={letterDraft}
                    onChange={(e) => setLetterDraft(e.target.value)}
                    rows={18}
                    className="font-serif text-base leading-relaxed"
                    placeholder="The drafted letter will appear here once processing completes."
                    data-testid="textarea-letter"
                  />
                )}
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

              {hasLetter && (
                <div className="flex justify-end">
                  <Button onClick={saveLetter} disabled={updateLetter.isPending} variant="outline" data-testid="button-save-letter">
                    {updateLetter.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                    Save changes
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <h3 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">Job details</h3>
                <div className="space-y-2">
                  <Input
                    placeholder="Company"
                    value={companyDraft}
                    onChange={(e) => setCompanyDraft(e.target.value)}
                    data-testid="input-company"
                  />
                  <Input
                    placeholder="Role title"
                    value={roleDraft}
                    onChange={(e) => setRoleDraft(e.target.value)}
                    data-testid="input-role-title"
                  />
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
                    Save details
                  </Button>
                </div>
              </div>

              <Button
                onClick={send}
                disabled={sendApp.isPending || isProcessing || !hasLetter}
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
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Validation gate {validationPassed && <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-700 ml-1" />}
                </h3>
              </div>
              {app.autoCorrectedAt && (
                <p className="text-xs text-muted-foreground mb-3" data-testid="text-auto-fix-history">
                  Auto-fixed {app.autoCorrectCount} time{app.autoCorrectCount === 1 ? "" : "s"} · last {format(new Date(app.autoCorrectedAt), "MMM d")}
                </p>
              )}
              {!app.validation ? (
                <p className="text-sm text-muted-foreground">No checks run yet.</p>
              ) : (
                <>
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
                          {!check.passed && NON_CORRECTABLE_HINTS[check.id] && (
                            <div className="text-xs text-amber-700 mt-0.5">
                              {NON_CORRECTABLE_HINTS[check.id]}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {canAutoFix && (
                    <Button
                      onClick={runAutoFix}
                      disabled={autoCorrect.isPending}
                      variant="outline"
                      size="sm"
                      className="w-full mt-4"
                      data-testid="button-auto-fix"
                    >
                      {autoCorrect.isPending ? (
                        <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Drafting fix…</>
                      ) : (
                        <><Wand2 className="w-3.5 h-3.5 mr-1.5" /> Auto-fix {failedAutoChecks.length} issue{failedAutoChecks.length === 1 ? "" : "s"}</>
                      )}
                    </Button>
                  )}
                </>
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

      <Dialog open={autoFixOpen} onOpenChange={(open) => { setAutoFixOpen(open); if (!open) setAutoFixPreview(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-auto-fix">
          <DialogHeader>
            <DialogTitle className="font-serif">Review the auto-fix</DialogTitle>
            <DialogDescription>
              Nothing is saved until you click Apply changes.
            </DialogDescription>
          </DialogHeader>
          {autoFixPreview && (
            <div className="space-y-5">
              <div>
                <h4 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">Targeting</h4>
                <div className="flex flex-wrap gap-1.5">
                  {autoFixPreview.targetedCheckIds.map((cid) => {
                    const label = app.validation?.checks.find((c) => c.id === cid)?.label ?? cid;
                    return (
                      <span key={cid} className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 text-xs border border-amber-200">
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>

              {autoFixPreview.summary.length > 0 && (
                <div>
                  <h4 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">What changed</h4>
                  <ul className="text-sm space-y-1 list-disc list-inside text-foreground/90">
                    {autoFixPreview.summary.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">Subject</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="border rounded-md p-3 bg-muted/30">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Before</div>
                    <div className="text-foreground/80 break-words">{app.emailSubject || <em className="text-muted-foreground">(none)</em>}</div>
                  </div>
                  <div className="border rounded-md p-3 border-emerald-300 bg-emerald-50/40">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-800 mb-1">After</div>
                    <div className="text-foreground break-words" data-testid="text-auto-fix-subject-after">{autoFixPreview.emailSubject}</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs uppercase tracking-[0.12em] text-muted-foreground mb-2">Cover letter</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="border rounded-md p-3 bg-muted/30 max-h-72 overflow-y-auto whitespace-pre-wrap font-serif leading-relaxed">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-sans not-italic">
                      Before · {wordCountOf(app.coverLetter ?? "")} words · {paragraphCountOf(app.coverLetter ?? "")} paragraphs
                    </div>
                    {app.coverLetter}
                  </div>
                  <div className="border rounded-md p-3 border-emerald-300 bg-emerald-50/40 max-h-72 overflow-y-auto whitespace-pre-wrap font-serif leading-relaxed" data-testid="text-auto-fix-letter-after">
                    <div className="text-[10px] uppercase tracking-wider text-emerald-800 mb-2 font-sans not-italic">
                      After · {wordCountOf(autoFixPreview.coverLetter)} words · {paragraphCountOf(autoFixPreview.coverLetter)} paragraphs
                    </div>
                    {autoFixPreview.coverLetter}
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAutoFixOpen(false); setAutoFixPreview(null); }} data-testid="button-auto-fix-cancel">
              Cancel
            </Button>
            <Button onClick={applyAutoFix} disabled={updateLetter.isPending || commitAutoCorrect.isPending} data-testid="button-auto-fix-apply">
              {(updateLetter.isPending || commitAutoCorrect.isPending) && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Apply changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

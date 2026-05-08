import { useState } from "react";
import { useLocation } from "wouter";
import {
  useCreateApplication,
  useGetProfile,
  getListApplicationsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function NewApplication() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [autoMode, setAutoMode] = useState(false);

  const { data: profile } = useGetProfile();
  const create = useCreateApplication();

  const profileReady = !!(profile?.fullName && profile?.email);
  const resumeReady = !!profile?.hasResume;

  const submit = async () => {
    if (tab === "url" && !url.trim()) {
      toast.error("Paste a job URL first.");
      return;
    }
    if (tab === "text" && !text.trim()) {
      toast.error("Paste the job description first.");
      return;
    }

    try {
      const created = await create.mutateAsync({
        data: {
          sourceType: tab,
          sourceUrl: tab === "url" ? url.trim() : null,
          sourceText: tab === "text" ? text.trim() : null,
          mode: autoMode ? "auto" : "preview",
          autoSend: autoMode,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast.success(
        created.status === "sent"
          ? "Sent. Application is on its way."
          : autoMode
            ? "Drafted. Review the details before sending."
            : "Job parsed. Review the details, then generate a letter.",
      );
      navigate(`/applications/${created.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      toast.error(message);
    }
  };

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
        </Link>
        <h1 className="font-serif text-3xl font-medium">New Application</h1>
        <p className="text-muted-foreground mt-1">
          Drop in a job. Career Pilot will extract the details, draft a letter in your voice,
          and run the quality gate.
        </p>
      </div>

      {(!profileReady || !resumeReady) && (
        <Alert variant="default" className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Finish setting up your profile first</AlertTitle>
          <AlertDescription className="mt-1">
            {!profileReady && <div>Add your name and email in Settings.</div>}
            {!resumeReady && <div>Upload your master resume PDF in Settings.</div>}
            <Link href="/settings" className="underline mt-2 inline-block">
              Open Settings
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-6 space-y-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "url" | "text")}>
            <TabsList className="grid grid-cols-2 w-full max-w-sm">
              <TabsTrigger value="url" data-testid="tab-url">Job URL</TabsTrigger>
              <TabsTrigger value="text" data-testid="tab-text">Paste Job Text</TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-2 mt-4">
              <Label htmlFor="url">Job posting URL</Label>
              <Input
                id="url"
                type="url"
                placeholder="https://company.com/careers/role"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="input-url"
              />
              <p className="text-xs text-muted-foreground">
                We'll fetch and parse the page server-side.
              </p>
            </TabsContent>

            <TabsContent value="text" className="space-y-2 mt-4">
              <Label htmlFor="text">Job description</Label>
              <Textarea
                id="text"
                placeholder="Paste the full job description here..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                className="font-mono text-sm"
                data-testid="input-text"
              />
            </TabsContent>
          </Tabs>

          <div className="flex items-start justify-between gap-6 border-t border-border pt-5">
            <div>
              <Label htmlFor="auto-mode" className="text-sm font-medium">
                Full-auto: draft and send when validation passes
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Off (default) parses the job so you can review the extracted details before
                generating a letter. On drafts and sends in one shot when every gate passes.
              </p>
            </div>
            <Switch
              id="auto-mode"
              checked={autoMode}
              onCheckedChange={setAutoMode}
              data-testid="switch-auto-mode"
            />
          </div>

          <Button
            onClick={submit}
            disabled={create.isPending || !profileReady || !resumeReady}
            size="lg"
            className="w-full"
            data-testid="button-submit"
          >
            {create.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {autoMode ? "Drafting..." : "Parsing..."}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                {autoMode ? "Draft, validate, and send" : "Parse job for review"}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

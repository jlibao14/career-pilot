import { useState, useEffect, useRef } from "react";
import {
  useGetProfile,
  useUpdateProfile,
  useSetResume,
  useRequestUploadUrl,
  getGetProfileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Upload, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useGetProfile();
  const update = useUpdateProfile();
  const setResume = useSetResume();
  const requestUpload = useRequestUploadUrl();

  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", location: "",
    linkedin: "", website: "", headline: "", summary: "",
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setForm({
        fullName: profile.fullName ?? "",
        email: profile.email ?? "",
        phone: profile.phone ?? "",
        location: profile.location ?? "",
        linkedin: profile.linkedin ?? "",
        website: profile.website ?? "",
        headline: profile.headline ?? "",
        summary: profile.summary ?? "",
      });
    }
  }, [profile?.id]);

  const save = async () => {
    if (!form.fullName.trim() || !form.email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    try {
      await update.mutateAsync({
        data: {
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          location: form.location.trim() || null,
          linkedin: form.linkedin.trim() || null,
          website: form.website.trim() || null,
          headline: form.headline.trim() || null,
          summary: form.summary.trim() || null,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      toast.success("Profile saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save profile");
    }
  };

  const handleResumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF.");
      return;
    }
    setUploading(true);
    try {
      const presigned = await requestUpload.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const putRes = await fetch(presigned.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      await setResume.mutateAsync({
        data: { objectPath: presigned.objectPath, fileName: file.name },
      });
      queryClient.invalidateQueries({ queryKey: getGetProfileQueryKey() });
      toast.success("Resume uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (isLoading || !profile) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl font-medium">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Your profile and master resume. Career Pilot uses this on every application.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-5">
          <h2 className="font-serif text-lg font-medium">Master resume</h2>
          {profile.resumeFileName ? (
            <div className="flex items-center justify-between gap-4 p-4 rounded-md border border-border bg-muted/30">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate" data-testid="text-resume-name">
                    {profile.resumeFileName}
                  </div>
                  <div className="text-xs text-emerald-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Attached to outgoing applications
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                data-testid="button-replace-resume"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                Replace
              </Button>
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-md p-8 text-center">
              <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <div className="font-medium">Upload your master resume PDF</div>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                One PDF, sent as an attachment with every application.
              </p>
              <Button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="button-upload-resume">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Upload className="w-3.5 h-3.5 mr-1.5" />}
                {uploading ? "Uploading..." : "Choose PDF"}
              </Button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleResumeChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <h2 className="font-serif text-lg font-medium">Your profile</h2>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Full name *">
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} data-testid="input-fullname" />
            </Field>
            <Field label="Email *">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-email" />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-phone" />
            </Field>
            <Field label="Location">
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="San Francisco, CA" data-testid="input-location" />
            </Field>
            <Field label="LinkedIn URL">
              <Input value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/..." data-testid="input-linkedin" />
            </Field>
            <Field label="Website">
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." data-testid="input-website" />
            </Field>
          </div>

          <Field label="Headline">
            <Input
              value={form.headline}
              onChange={(e) => setForm({ ...form, headline: e.target.value })}
              placeholder="VP of Engineering · 12 years scaling consumer platforms"
              data-testid="input-headline"
            />
          </Field>

          <Field label="Summary / pitch">
            <Textarea
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              rows={6}
              placeholder="A few sentences about who you are, what you've built, and what you're looking for. The model uses this verbatim — be concrete."
              data-testid="textarea-summary"
            />
          </Field>

          <div className="flex justify-end">
            <Button onClick={save} disabled={update.isPending} data-testid="button-save-profile">
              {update.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Save profile
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}

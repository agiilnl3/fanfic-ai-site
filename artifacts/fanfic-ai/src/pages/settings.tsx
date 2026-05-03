import { useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { useAuthor } from "@/hooks/use-author";
import {
  useGetNotificationPrefs,
  useUpdateNotificationPrefs,
  getGetNotificationPrefsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, Settings as SettingsIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FIELDS = [
  { key: "comment", label: "New comments on my stories" },
  { key: "follow", label: "New followers" },
  { key: "like", label: "Likes on my stories" },
  { key: "repost", label: "Reposts of my stories" },
  { key: "coAuthorChapter", label: "Co-author added a chapter" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

export default function SettingsPage() {
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const recipient = authorName?.trim() ?? "";

  const queryKey = getGetNotificationPrefsQueryKey(recipient || "x");
  const { data, isLoading } = useGetNotificationPrefs(recipient || "x", {
    query: { queryKey, enabled: !!recipient },
  });

  const [prefs, setPrefs] = useState<Record<FieldKey, boolean>>({
    comment: true,
    follow: true,
    like: true,
    repost: true,
    coAuthorChapter: true,
  });

  useEffect(() => {
    if (data) {
      setPrefs({
        comment: data.comment,
        follow: data.follow,
        like: data.like,
        repost: data.repost,
        coAuthorChapter: data.coAuthorChapter,
      });
    }
  }, [data]);

  const update = useUpdateNotificationPrefs({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey });
        toast({ title: "Preferences saved" });
      },
      onError: () =>
        toast({ title: "Failed to save preferences", variant: "destructive" }),
    },
  });

  const toggle = (key: FieldKey, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    if (recipient) {
      update.mutate({ name: recipient, data: { [key]: value } });
    }
  };

  return (
    <Layout>
      <Seo title="Settings" description="Manage your notification preferences." />
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="flex items-center gap-3 mb-8">
          <SettingsIcon className="w-7 h-7 text-primary" />
          <h1 className="font-serif text-3xl md:text-4xl font-bold">Settings</h1>
        </div>

        {!recipient ? (
          <div className="text-center py-12 border border-dashed border-border/50 rounded-2xl bg-card/10">
            <p className="text-muted-foreground">
              Set a pen name on the New Story page to manage settings.
            </p>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="font-serif">Notifications</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                FIELDS.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-center justify-between gap-4"
                  >
                    <label
                      htmlFor={`pref-${f.key}`}
                      className="text-sm cursor-pointer"
                    >
                      {f.label}
                    </label>
                    <Switch
                      id={`pref-${f.key}`}
                      checked={prefs[f.key]}
                      onCheckedChange={(v) => toggle(f.key, !!v)}
                      data-testid={`switch-pref-${f.key}`}
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

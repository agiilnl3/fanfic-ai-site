import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { useAuthor } from "@/hooks/use-author";
import {
  useGetNotificationPrefs,
  useUpdateNotificationPrefs,
  getGetNotificationPrefsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Settings as SettingsIcon, UserCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const FIELD_KEYS = ["comment", "follow", "like", "repost", "coAuthorChapter"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function ProfileEditor() {
  const { t } = useTranslation();
  const { me, refetchMe, isSignedIn } = useAuthor();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    if (me) {
      setHandle(me.handle ?? "");
      setDisplayName(me.displayName ?? "");
      setBio(me.bio ?? "");
    }
  }, [me]);

  const save = useMutation({
    mutationFn: async () => {
      const base = import.meta.env.BASE_URL || "/";
      const res = await fetch(`${base}api/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ handle, displayName, bio }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("settings.saved", "Saved") });
      void refetchMe();
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      toast({ title: err.message, variant: "destructive" });
    },
  });

  if (!isSignedIn || !me) return null;

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="font-serif flex items-center gap-2">
          <UserCircle2 className="w-5 h-5 text-primary" />
          {t("settings.profile", "Author profile")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="profile-handle">{t("settings.handle", "Handle")}</Label>
          <Input
            id="profile-handle"
            value={handle}
            onChange={(e) =>
              setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
            }
            placeholder="your_handle"
            data-testid="input-handle"
            maxLength={30}
          />
          <p className="text-xs text-muted-foreground">
            {t("settings.handleHelp", "Lowercase letters, digits, and underscores. Used in your /author/:handle URL.")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-displayname">{t("settings.displayName", "Display name")}</Label>
          <Input
            id="profile-displayname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t("settings.displayNamePlaceholder", "Your pen name") ?? ""}
            maxLength={80}
            data-testid="input-displayname"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-bio">{t("settings.bio", "Bio")}</Label>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t("settings.bioPlaceholder", "Tell readers about yourself") ?? ""}
            maxLength={500}
            rows={4}
            data-testid="input-bio"
          />
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-profile">
          {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {t("settings.saveProfile", "Save profile")}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation();
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
        toast({ title: t("settings.saved") });
      },
      onError: () =>
        toast({ title: t("settings.saveFailed"), variant: "destructive" }),
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
      <Seo title={t("settings.seoTitle")} description={t("settings.seoDesc")} />
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="flex items-center gap-3 mb-8">
          <SettingsIcon className="w-7 h-7 text-primary" />
          <h1 className="font-serif text-3xl md:text-4xl font-bold">{t("settings.title")}</h1>
        </div>

        <Show when="signed-in">
          <ProfileEditor />
        </Show>

        <Show when="signed-out">
          <div className="text-center py-12 border border-dashed border-border/50 rounded-2xl bg-card/10">
            <p className="text-muted-foreground">
              {t("auth.signInToManage", "Sign in to manage your profile and notifications.")}
            </p>
          </div>
        </Show>

        {recipient && (
          <Card>
            <CardHeader>
              <CardTitle className="font-serif">{t("settings.notifications")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                FIELD_KEYS.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4"
                  >
                    <label
                      htmlFor={`pref-${key}`}
                      className="text-sm cursor-pointer"
                    >
                      {t(`settings.${key}`)}
                    </label>
                    <Switch
                      id={`pref-${key}`}
                      checked={prefs[key]}
                      onCheckedChange={(v) => toggle(key, !!v)}
                      data-testid={`switch-pref-${key}`}
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

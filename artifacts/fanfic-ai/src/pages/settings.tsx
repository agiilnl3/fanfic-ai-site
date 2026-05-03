import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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

const FIELD_KEYS = ["comment", "follow", "like", "repost", "coAuthorChapter"] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

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

        {!recipient ? (
          <div className="text-center py-12 border border-dashed border-border/50 rounded-2xl bg-card/10">
            <p className="text-muted-foreground">{t("settings.setPenName")}</p>
          </div>
        ) : (
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

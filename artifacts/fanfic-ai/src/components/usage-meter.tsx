import { useTranslation } from "react-i18next";
import { useGetMyUsage, getGetMyUsageQueryKey } from "@workspace/api-client-react";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export function UsageMeter({ authorName }: { authorName: string }) {
  const { t } = useTranslation();
  const { data } = useGetMyUsage(
    { authorName },
    {
      query: {
        enabled: !!authorName.trim(),
        refetchInterval: 60_000,
        queryKey: getGetMyUsageQueryKey({ authorName }),
      },
    },
  );
  if (!data) return null;
  const storyPct = data.storyLimit
    ? Math.min(100, Math.round((data.storyCount / data.storyLimit) * 100))
    : 0;
  const illPct = data.illustrationLimit
    ? Math.min(100, Math.round((data.illustrationCount / data.illustrationLimit) * 100))
    : 0;

  return (
    <Card className="p-3 bg-card/40 border-primary/20">
      <div className="flex items-center gap-1.5 mb-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Sparkles className="w-3.5 h-3.5" /> {t("usage.label")}
      </div>
      <div className="space-y-2.5">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span>{t("usage.stories")}</span>
            <span className="tabular-nums text-muted-foreground">
              {data.storyCount} / {data.storyLimit}
            </span>
          </div>
          <Progress value={storyPct} className="h-1.5" />
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span>{t("usage.illustrations")}</span>
            <span className="tabular-nums text-muted-foreground">
              {data.illustrationCount} / {data.illustrationLimit}
            </span>
          </div>
          <Progress value={illPct} className="h-1.5" />
        </div>
      </div>
    </Card>
  );
}

import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetAuthorProfile,
  getGetAuthorProfileQueryKey,
  useListAuthorReposts,
  getListAuthorRepostsQueryKey,
} from "@workspace/api-client-react";
import { formatDistanceToNow, format } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import { Repeat2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { StoryCard } from "@/components/story-card";
import { FollowButton } from "@/components/follow-button";
import { ReportButton } from "@/components/report-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { BookOpen, Heart, Users, UserPlus } from "lucide-react";

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BookOpen;
  label: string;
  value: number | string;
}) {
  return (
    <Card className="p-4 flex items-center gap-3 bg-card/50">
      <Icon className="w-5 h-5 text-primary" />
      <div>
        <div className="font-serif text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      </div>
    </Card>
  );
}

export default function AuthorPage() {
  const { t, i18n } = useTranslation();
  const [, params] = useRoute<{ name: string }>("/author/:name");
  const name = params?.name ? decodeURIComponent(params.name) : "";

  const { data, isLoading, error } = useGetAuthorProfile(name, {
    query: {
      enabled: !!name,
      staleTime: 60_000,
      queryKey: getGetAuthorProfileQueryKey(name),
    },
  });

  const { data: reposts } = useListAuthorReposts(name, {
    query: {
      enabled: !!name,
      staleTime: 60_000,
      queryKey: getListAuthorRepostsQueryKey(name),
    },
  });

  const isRu = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("ru");
  const dateLocale = isRu ? ruLocale : undefined;
  const monthYearFmt = isRu ? "LLLL yyyy" : "MMMM yyyy";

  return (
    <Layout>
      <Seo
        title={name ? `${name} — ${t("author.seoTitleSuffix")}` : t("author.seoTitleSuffix")}
        description={name ? t("author.seoDesc", { name }) : ""}
      />
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        {isLoading && (
          <div className="space-y-6">
            <Skeleton className="h-32 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[400px] w-full rounded-xl" />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="text-center py-32">
            <h1 className="font-serif text-3xl mb-2">{t("author.notFoundTitle")}</h1>
            <p className="text-muted-foreground">
              {t("author.notFoundBody", { name })}
            </p>
            <Link href="/feed" className="text-primary underline mt-4 inline-block">
              {t("author.backToLibrary")}
            </Link>
          </div>
        )}
        {data && (
          <>
            <div className="mb-10">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
                <div>
                  <h1 className="font-serif text-4xl md:text-5xl font-bold glow-text">
                    {data.authorName}
                  </h1>
                  {data.firstSeenAt && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("author.joined", {
                        date: format(new Date(data.firstSeenAt), monthYearFmt, { locale: dateLocale }),
                      })}
                    </p>
                  )}
                </div>
                <FollowButton authorName={data.authorName} size="default" showCount />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={BookOpen} label={t("author.publishedStat")} value={data.publishedCount} />
                <StatCard icon={Heart} label={t("author.totalLikes")} value={data.totalLikes} />
                <StatCard icon={Users} label={t("author.followers")} value={data.followerCount} />
                <StatCard icon={UserPlus} label={t("author.followingStat")} value={data.followingCount} />
              </div>
            </div>

            <h2 className="font-serif text-2xl mb-6">{t("author.publishedTales")}</h2>
            {data.stories.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-border/50 rounded-2xl bg-card/10">
                <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">
                  {t("author.noPublished", { name: data.authorName })}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {data.stories.map((story) => (
                  <StoryCard key={story.id} story={story} />
                ))}
              </div>
            )}

            {reposts && reposts.length > 0 && (
              <div className="mt-12">
                <h2 className="font-serif text-2xl mb-2 flex items-center gap-2">
                  <Repeat2 className="w-5 h-5 text-primary" />
                  {t("author.repostedTales")}
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                  {t("author.repostedSubtitle", { name: data.authorName })}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {reposts.map((entry) => (
                    <div key={entry.repostId} className="space-y-2">
                      <StoryCard story={entry.story} />
                      <div className="flex items-center justify-between gap-2 px-1">
                        <div className="text-xs text-muted-foreground">
                          {t("author.repostedTime", {
                            time: formatDistanceToNow(new Date(entry.repostedAt), { addSuffix: true, locale: dateLocale }),
                          })}
                          {entry.note ? ` — “${entry.note}”` : ""}
                        </div>
                        <ReportButton targetType="repost" targetId={entry.repostId} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

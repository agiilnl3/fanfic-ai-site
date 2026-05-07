import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetPublicFeed,
  getGetPublicFeedQueryKey,
  type GetPublicFeedParams,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { StoryCard } from "@/components/story-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuthor } from "@/hooks/use-author";

export default function TagPage() {
  const { t } = useTranslation();
  const [, params] = useRoute<{ slug: string }>("/tag/:slug");
  const slug = params?.slug ? decodeURIComponent(params.slug) : "";
  const { authorName } = useAuthor();

  const feedParams: GetPublicFeedParams = {
    tag: slug || undefined,
    sort: "new",
    viewerAuthorName: authorName?.trim() || undefined,
  };

  const { data, isLoading } = useGetPublicFeed(feedParams, {
    query: {
      enabled: !!slug,
      queryKey: getGetPublicFeedQueryKey(feedParams),
      staleTime: 60_000,
    },
  });

  const title = t("tag.seoTitle", "#{{slug}} — stories", { slug });
  const desc = t(
    "tag.seoDesc",
    "Browse community-written fanfiction tagged #{{slug}} on FanFic AI.",
    { slug },
  );

  return (
    <Layout>
      <Seo title={title} description={desc} />
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col items-center mb-10 text-center">
          <Badge
            variant="secondary"
            className="text-base px-3 py-1 mb-4"
            data-testid="badge-tag-header"
          >
            #{slug}
          </Badge>
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-3 glow-text">
            {t("tag.title", "Tagged #{{slug}}", { slug })}
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            {t("tag.subtitle", "Every public story carrying this tag, newest first.")}
          </p>
          <Link
            href="/feed"
            className="text-sm text-primary hover:underline mt-3"
            data-testid="link-back-to-feed"
          >
            ← {t("tag.backToFeed", "Back to all stories")}
          </Link>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!isLoading && data && data.length === 0 && (
          <div
            className="text-center text-muted-foreground py-20"
            data-testid="empty-tag-feed"
          >
            <p className="text-lg">
              {t("tag.empty", "No stories yet for this tag.")}
            </p>
          </div>
        )}

        {!isLoading && data && data.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.map((story) => (
              <StoryCard key={story.id} story={story} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}

import { useTranslation } from "react-i18next";
import {
  useGetSimilarStories,
  getGetSimilarStoriesQueryKey,
} from "@workspace/api-client-react";
import { StoryCard } from "@/components/story-card";
import { Skeleton } from "@/components/ui/skeleton";

export function SimilarStories({ storyId }: { storyId: number }) {
  const { t } = useTranslation();
  const params = { limit: 6 };
  const { data, isLoading } = useGetSimilarStories(storyId, params, {
    query: {
      queryKey: getGetSimilarStoriesQueryKey(storyId, params),
      staleTime: 5 * 60_000,
    },
  });

  if (isLoading) {
    return (
      <section
        className="container mx-auto px-4 mt-16"
        aria-label={t("similar.title", "Similar stories")}
      >
        <h2 className="font-serif text-2xl md:text-3xl font-bold mb-6">
          {t("similar.title", "Similar stories")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (!data || data.length === 0) return null;

  return (
    <section
      className="container mx-auto px-4 mt-16"
      aria-label={t("similar.title", "Similar stories")}
      data-testid="section-similar-stories"
    >
      <h2 className="font-serif text-2xl md:text-3xl font-bold mb-6">
        {t("similar.title", "Similar stories")}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {data.map((story) => (
          <StoryCard key={story.id} story={story} />
        ))}
      </div>
    </section>
  );
}

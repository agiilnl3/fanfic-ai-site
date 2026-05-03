import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import { Story, getGetStoryQueryOptions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, MessageCircle } from "lucide-react";
import { LikeButton } from "@/components/like-button";
import { BookmarkButton } from "@/components/bookmark-button";

export function StoryCard({ story }: { story: Story }) {
  const { t, i18n } = useTranslation();
  const tags = (story as Story & { tags?: { id: number; slug: string; label: string }[] }).tags;
  const progress = (story as Story & { readingProgress?: number | null }).readingProgress;
  const queryClient = useQueryClient();

  const handlePrefetch = () => {
    queryClient.prefetchQuery({
      ...getGetStoryQueryOptions(story.id),
      staleTime: 30_000,
    });
  };

  const isRu = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("ru");
  const dateLocale = isRu ? ruLocale : undefined;
  const dateFmt = isRu ? "d MMM yyyy" : "MMM d, yyyy";

  return (
    <Link
      href={`/story/${story.id}`}
      className="block group h-full"
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onTouchStart={handlePrefetch}
    >
      <Card className="h-full bg-card hover:bg-card/80 transition-all border-border/50 overflow-hidden flex flex-col book-shadow hover:-translate-y-1 duration-300">
        <div className="aspect-[3/4] w-full relative bg-muted overflow-hidden">
          {story.coverImageUrl ? (
            <img
              src={story.coverImageUrl}
              alt={story.title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-secondary">
              <BookOpen className="w-12 h-12 text-muted-foreground/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
          <div className="absolute bottom-3 left-3 right-3">
            <Badge variant="secondary" className="bg-primary/20 text-primary border-primary/30 backdrop-blur-sm mb-2">
              {t(`genres.${story.genre}`, story.genre)}
            </Badge>
          </div>
        </div>
        <CardHeader className="p-4 pb-2">
          <h3 className="font-serif text-xl font-bold line-clamp-2 leading-tight group-hover:text-primary transition-colors">
            {story.title}
          </h3>
        </CardHeader>
        <CardContent className="p-4 pt-0 flex-1">
          <p className="text-muted-foreground text-sm italic">
            {t("storyCard.by")}{" "}
            <span
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = `${import.meta.env.BASE_URL}author/${encodeURIComponent(story.authorName)}`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  window.location.href = `${import.meta.env.BASE_URL}author/${encodeURIComponent(story.authorName)}`;
                }
              }}
              className="hover:text-primary hover:underline cursor-pointer"
            >
              {story.authorName}
            </span>
          </p>
          {story.summary && (
            <p className="text-sm text-foreground/70 mt-3 line-clamp-3 leading-relaxed">
              {story.summary}
            </p>
          )}
          {tags && tags.length > 0 && (
            <div
              className="flex flex-wrap gap-1 mt-3"
              data-testid={`tags-${story.id}`}
            >
              {tags.slice(0, 4).map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 font-normal"
                >
                  #{tag.label}
                </Badge>
              ))}
            </div>
          )}
          {typeof progress === "number" && progress > 0 && progress < 100 && (
            <div
              className="mt-3 text-xs text-primary/80 inline-flex items-center gap-1"
              data-testid={`progress-${story.id}`}
            >
              <BookOpen className="w-3 h-3" />
              {t("storyCard.continueFrom", { progress })}
            </div>
          )}
        </CardContent>
        <CardFooter className="p-4 pt-0 text-xs text-muted-foreground flex justify-between items-center border-t border-border/10">
          <div className="flex items-center gap-2">
            <span>{story.lengthSetting}</span>
            <LikeButton storyId={story.id} />
            <span
              className="inline-flex items-center gap-1 text-muted-foreground tabular-nums"
              data-testid={`comment-count-${story.id}`}
              title={t("storyCard.commentsTitle", { count: story.commentCount })}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              {story.commentCount}
            </span>
            <BookmarkButton storyId={story.id} variant="compact" />
          </div>
          <span>{format(new Date(story.createdAt), dateFmt, { locale: dateLocale })}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}

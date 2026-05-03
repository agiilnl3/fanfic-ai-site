import { Link } from "wouter";
import { format } from "date-fns";
import { Story, getGetStoryQueryOptions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, MessageCircle } from "lucide-react";
import { LikeButton } from "@/components/like-button";
import { BookmarkButton } from "@/components/bookmark-button";

export function StoryCard({ story }: { story: Story }) {
  const queryClient = useQueryClient();

  const handlePrefetch = () => {
    queryClient.prefetchQuery({
      ...getGetStoryQueryOptions(story.id),
      staleTime: 30_000,
    });
  };

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
              {story.genre}
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
            by{" "}
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
        </CardContent>
        <CardFooter className="p-4 pt-0 text-xs text-muted-foreground flex justify-between items-center border-t border-border/10">
          <div className="flex items-center gap-2">
            <span>{story.lengthSetting}</span>
            <LikeButton storyId={story.id} />
            <span
              className="inline-flex items-center gap-1 text-muted-foreground tabular-nums"
              data-testid={`comment-count-${story.id}`}
              title={`${story.commentCount} comment${story.commentCount === 1 ? "" : "s"}`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              {story.commentCount}
            </span>
            <BookmarkButton storyId={story.id} variant="compact" />
          </div>
          <span>{format(new Date(story.createdAt), "MMM d, yyyy")}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}

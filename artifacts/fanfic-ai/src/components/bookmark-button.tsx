import {
  useGetBookmarkInfo,
  useAddBookmark,
  useRemoveBookmark,
  getGetBookmarkInfoQueryKey,
  getListBookmarksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import { Button } from "@/components/ui/button";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function BookmarkButton({
  storyId,
  variant = "default",
}: {
  storyId: number;
  variant?: "default" | "compact";
}) {
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = { authorName: authorName || undefined };
  const queryKey = getGetBookmarkInfoQueryKey(storyId, params);

  const { data } = useGetBookmarkInfo(storyId, params, {
    query: { queryKey, enabled: true, staleTime: 30_000 },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    if (authorName)
      queryClient.invalidateQueries({
        queryKey: getListBookmarksQueryKey(authorName),
      });
  };

  const add = useAddBookmark({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({ title: "Saved to your library" });
      },
    },
  });
  const remove = useRemoveBookmark({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({ title: "Removed from library" });
      },
    },
  });

  const bookmarked = !!data?.bookmarked;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authorName?.trim()) {
      toast({
        title: "Set your pen name first",
        description: "Open the New Story page to choose a name.",
      });
      return;
    }
    if (bookmarked) {
      remove.mutate({ id: storyId, params: { authorName } });
    } else {
      add.mutate({ id: storyId, data: { authorName } });
    }
  };

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={bookmarked ? "Remove bookmark" : "Add bookmark"}
        aria-pressed={bookmarked}
        className="inline-flex items-center text-muted-foreground hover:text-primary transition-colors"
        data-testid={`button-bookmark-compact-${storyId}`}
      >
        {bookmarked ? (
          <BookmarkCheck className="w-4 h-4 text-primary" />
        ) : (
          <Bookmark className="w-4 h-4" />
        )}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={bookmarked ? "default" : "outline"}
      size="sm"
      onClick={handleClick}
      aria-pressed={bookmarked}
      data-testid={`button-bookmark-${storyId}`}
    >
      {bookmarked ? (
        <>
          <BookmarkCheck className="w-4 h-4 mr-1" /> Saved
        </>
      ) : (
        <>
          <Bookmark className="w-4 h-4 mr-1" /> Save
        </>
      )}
    </Button>
  );
}

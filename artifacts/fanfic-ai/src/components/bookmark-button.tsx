import { useTranslation } from "react-i18next";
import {
  useGetBookmarkInfo,
  useAddBookmark,
  useRemoveBookmark,
  getGetBookmarkInfoQueryKey,
  getListBookmarksQueryKey,
  type BookmarkInfo,
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
  const { t } = useTranslation();
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = { authorName: authorName || undefined };
  const queryKey = getGetBookmarkInfoQueryKey(storyId, params);

  const { data } = useGetBookmarkInfo(storyId, params, {
    query: { queryKey, enabled: true, staleTime: 30_000 },
  });

  const setBookmarked = (next: boolean) => {
    queryClient.setQueryData<BookmarkInfo | undefined>(queryKey, (old) =>
      old ? { ...old, bookmarked: next } : { storyId, bookmarked: next },
    );
  };

  const settle = () => {
    queryClient.invalidateQueries({ queryKey });
    if (authorName)
      queryClient.invalidateQueries({
        queryKey: getListBookmarksQueryKey(authorName),
      });
  };

  const add = useAddBookmark({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData<BookmarkInfo | undefined>(queryKey);
        setBookmarked(true);
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev !== undefined) queryClient.setQueryData(queryKey, ctx.prev);
        toast({ title: t("bookmark.failed", "Could not save"), variant: "destructive" });
      },
      onSuccess: () => toast({ title: t("bookmark.savedToast") }),
      onSettled: settle,
    },
  });

  const remove = useRemoveBookmark({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData<BookmarkInfo | undefined>(queryKey);
        setBookmarked(false);
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev !== undefined) queryClient.setQueryData(queryKey, ctx.prev);
        toast({ title: t("bookmark.failed", "Could not remove"), variant: "destructive" });
      },
      onSuccess: () => toast({ title: t("bookmark.removedToast") }),
      onSettled: settle,
    },
  });

  const bookmarked = !!data?.bookmarked;
  // Lock both add and remove while either is in flight; otherwise rapid
  // double-clicks can interleave and leave the cache out of sync with
  // the server until the next 30s staleTime refetch.
  const busy = add.isPending || remove.isPending;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authorName?.trim()) {
      toast({
        title: t("bookmark.setPenNameTitle"),
        description: t("bookmark.setPenNameDesc"),
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
        disabled={busy}
        aria-label={bookmarked ? t("bookmark.removeAria") : t("bookmark.addAria")}
        aria-pressed={bookmarked}
        className="inline-flex items-center text-muted-foreground hover:text-primary transition-colors disabled:opacity-60"
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
      disabled={busy}
      aria-pressed={bookmarked}
      data-testid={`button-bookmark-${storyId}`}
    >
      {bookmarked ? (
        <>
          <BookmarkCheck className="w-4 h-4 mr-1" /> {t("bookmark.saved")}
        </>
      ) : (
        <>
          <Bookmark className="w-4 h-4 mr-1" /> {t("bookmark.save")}
        </>
      )}
    </Button>
  );
}

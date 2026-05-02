import { useGetStoryLike, useLikeStory, useUnlikeStory, getGetStoryLikeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface LikeButtonProps {
  storyId: number;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "ghost" | "outline" | "default" | "secondary";
  className?: string;
  showCount?: boolean;
}

export function LikeButton({
  storyId,
  size = "sm",
  variant = "ghost",
  className,
  showCount = true,
}: LikeButtonProps) {
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = authorName ? { authorName } : undefined;
  const queryKey = getGetStoryLikeQueryKey(storyId, params);

  const { data } = useGetStoryLike(storyId, params, {
    query: { staleTime: 30_000, queryKey },
  });

  const likeMutation = useLikeStory({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (old: typeof data) =>
          old ? { ...old, hasLiked: true, likeCount: old.likeCount + (old.hasLiked ? 0 : 1) } : { storyId, hasLiked: true, likeCount: 1 },
        );
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev !== undefined) queryClient.setQueryData(queryKey, ctx.prev);
        toast({ title: "Failed to like", variant: "destructive" });
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey }),
    },
  });

  const unlikeMutation = useUnlikeStory({
    mutation: {
      onMutate: async () => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (old: typeof data) =>
          old ? { ...old, hasLiked: false, likeCount: Math.max(0, old.likeCount - (old.hasLiked ? 1 : 0)) } : old,
        );
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev !== undefined) queryClient.setQueryData(queryKey, ctx.prev);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey }),
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authorName?.trim()) {
      toast({
        title: "Set your pen name first",
        description: "Open the New Story page to choose a name before you can like.",
      });
      return;
    }
    if (data?.hasLiked) {
      unlikeMutation.mutate({ id: storyId, params: { authorName } });
    } else {
      likeMutation.mutate({ id: storyId, data: { authorName } });
    }
  };

  const liked = !!data?.hasLiked;
  const count = data?.likeCount ?? 0;
  const busy = likeMutation.isPending || unlikeMutation.isPending;

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={handleClick}
      disabled={busy}
      aria-label={liked ? "Unlike story" : "Like story"}
      data-testid={`button-like-${storyId}`}
      className={cn(
        "gap-1.5 px-2",
        liked && "text-rose-500 hover:text-rose-600",
        className,
      )}
    >
      <Heart className={cn("w-4 h-4 transition-transform", liked && "fill-current scale-110")} />
      {showCount && <span className="tabular-nums text-xs">{count}</span>}
    </Button>
  );
}

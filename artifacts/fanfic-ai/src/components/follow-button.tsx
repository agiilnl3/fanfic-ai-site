import {
  useGetAuthorFollow,
  useFollowAuthor,
  useUnfollowAuthor,
  getGetAuthorFollowQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowButtonProps {
  authorName: string;
  size?: "sm" | "default" | "lg";
  variant?: "default" | "outline" | "ghost";
  className?: string;
  showCount?: boolean;
}

export function FollowButton({
  authorName,
  size = "sm",
  variant = "outline",
  className,
  showCount = false,
}: FollowButtonProps) {
  const { authorName: follower } = useAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = follower ? { followerName: follower } : undefined;
  const queryKey = getGetAuthorFollowQueryKey(authorName, params);
  const { data } = useGetAuthorFollow(authorName, params, {
    query: { staleTime: 30_000, queryKey },
  });

  const followMutation = useFollowAuthor({
    mutation: {
      onSuccess: (next) => queryClient.setQueryData(queryKey, next),
      onError: () => toast({ title: "Failed to follow", variant: "destructive" }),
    },
  });
  const unfollowMutation = useUnfollowAuthor({
    mutation: {
      onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    },
  });

  const isSelf = follower && follower === authorName;
  if (isSelf) return null;

  const isFollowing = !!data?.isFollowing;
  const busy = followMutation.isPending || unfollowMutation.isPending;

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!follower?.trim()) {
      toast({
        title: "Set your pen name first",
        description: "Open the New Story page to choose a name before you can follow.",
      });
      return;
    }
    if (isFollowing) {
      unfollowMutation.mutate({ name: authorName, params: { followerName: follower } });
    } else {
      followMutation.mutate({ name: authorName, data: { followerName: follower } });
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={isFollowing ? "secondary" : variant}
      onClick={onClick}
      disabled={busy}
      className={cn("gap-1.5", className)}
      data-testid={`button-follow-${authorName}`}
    >
      {isFollowing ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
      <span>{isFollowing ? "Following" : "Follow"}</span>
      {showCount && data && (
        <span className="text-xs tabular-nums opacity-70">· {data.followerCount}</span>
      )}
    </Button>
  );
}

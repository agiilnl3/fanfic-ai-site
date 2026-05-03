import { useState } from "react";
import {
  useGetStoryRepost,
  useRepostStory,
  useUnrepostStory,
  getGetStoryRepostQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import { Button } from "@/components/ui/button";
import { Repeat2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function RepostButton({
  storyId,
  size = "sm",
}: {
  storyId: number;
  size?: "sm" | "default";
}) {
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const reposter = authorName?.trim() || "";
  const queryKey = getGetStoryRepostQueryKey(storyId, { reposterName: reposter || undefined });

  const { data } = useGetStoryRepost(
    storyId,
    { reposterName: reposter || undefined },
    { query: { enabled: !!storyId, queryKey } },
  );

  const repost = useRepostStory({
    mutation: {
      onSuccess: (info) => queryClient.setQueryData(queryKey, info),
    },
  });
  const unrepost = useUnrepostStory({
    mutation: {
      onSuccess: (info) => queryClient.setQueryData(queryKey, info),
    },
  });

  const [submitting, setSubmitting] = useState(false);
  const isPending = submitting || repost.isPending || unrepost.isPending;

  const handle = async () => {
    if (!reposter) return;
    setSubmitting(true);
    try {
      if (data?.hasReposted) {
        await unrepost.mutateAsync({ id: storyId, params: { reposterName: reposter } });
      } else {
        await repost.mutateAsync({ id: storyId, data: { reposterName: reposter } });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reposted = !!data?.hasReposted;
  const count = data?.repostCount ?? 0;

  return (
    <Button
      variant={reposted ? "default" : "outline"}
      size={size}
      onClick={handle}
      disabled={!reposter || isPending}
      title={reposter ? "Repost to your profile" : "Set a pen name to repost"}
      data-testid={`button-repost-${storyId}`}
      className={cn("gap-1.5", reposted && "bg-emerald-600 hover:bg-emerald-700 text-white")}
    >
      {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat2 className="w-4 h-4" />}
      <span className="tabular-nums">{count}</span>
    </Button>
  );
}

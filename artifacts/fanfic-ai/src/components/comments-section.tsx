import { useState } from "react";
import {
  useGetStoryComments,
  useAddStoryComment,
  useDeleteStoryComment,
  getGetStoryCommentsQueryKey,
  getGetStoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { MessageCircle, Loader2, Trash2, Send } from "lucide-react";

export function CommentsSection({ storyId }: { storyId: number }) {
  const { authorName } = useAuthor();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const queryKey = getGetStoryCommentsQueryKey(storyId);
  const { data: comments, isLoading } = useGetStoryComments(storyId, {
    query: { queryKey, staleTime: 30_000 },
  });

  const addMutation = useAddStoryComment({
    mutation: {
      onSuccess: () => {
        setDraft("");
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
        toast({ title: "Comment posted" });
      },
      onError: () =>
        toast({ title: "Failed to post comment", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteStoryComment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey });
        queryClient.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
      },
      onError: () =>
        toast({ title: "Failed to delete comment", variant: "destructive" }),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorName?.trim()) {
      toast({
        title: "Set your pen name first",
        description: "Open the New Story page to choose a name before commenting.",
      });
      return;
    }
    const text = draft.trim();
    if (!text) return;
    addMutation.mutate({ id: storyId, data: { authorName, body: text } });
  };

  const list = comments ?? [];

  return (
    <section
      className="container mx-auto px-4 mt-16 max-w-3xl"
      data-testid="comments-section"
    >
      <div className="border-t border-border/50 pt-12">
        <div className="flex items-center gap-2 mb-6">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h2 className="font-serif text-2xl">
            Reader Comments
            <span className="text-muted-foreground ml-2 text-base">
              ({list.length})
            </span>
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="mb-8 space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              authorName
                ? `Share your thoughts as ${authorName}…`
                : "Set a pen name to leave a comment…"
            }
            rows={3}
            maxLength={2000}
            className="bg-card/50 border-primary/20 focus:border-primary/50"
            data-testid="textarea-new-comment"
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {draft.length}/2000
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={
                addMutation.isPending || !draft.trim() || !authorName?.trim()
              }
              data-testid="button-post-comment"
            >
              {addMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Post Comment
            </Button>
          </div>
        </form>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-sm italic text-center py-8">
            No comments yet — be the first to share your thoughts.
          </p>
        ) : (
          <ul className="space-y-4">
            {list.map((comment) => {
              const mine =
                authorName.trim() &&
                comment.authorName === authorName.trim();
              const isDeleting =
                deleteMutation.isPending &&
                (deleteMutation.variables as { commentId: number } | undefined)
                  ?.commentId === comment.id;
              return (
                <li
                  key={comment.id}
                  className="rounded-lg border border-border/40 bg-card/40 p-4"
                  data-testid={`comment-${comment.id}`}
                >
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-serif font-semibold text-foreground">
                        {comment.authorName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(comment.createdAt), "MMM d, yyyy · h:mm a")}
                      </span>
                    </div>
                    {mine && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={isDeleting}
                        onClick={() =>
                          deleteMutation.mutate({
                            id: storyId,
                            commentId: comment.id,
                            params: { authorName },
                          })
                        }
                        aria-label="Delete comment"
                        data-testid={`button-delete-comment-${comment.id}`}
                      >
                        {isDeleting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                    {comment.body}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

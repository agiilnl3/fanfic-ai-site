import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetStoryComments,
  useAddStoryComment,
  getGetStoryCommentsQueryKey,
  getGetParagraphCommentCountsQueryKey,
  type StoryComment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import { MessageSquarePlus, Loader2, Send } from "lucide-react";

type Props = {
  storyId: number;
  paragraphIndex: number;
  count: number;
};

export function ParagraphCommentsPopover({
  storyId,
  paragraphIndex,
  count,
}: Props) {
  const { t, i18n } = useTranslation();
  const { authorName } = useAuthor();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  // Defer fetch until the popover opens.
  const commentsKey = getGetStoryCommentsQueryKey(storyId);
  const { data: allComments, isLoading } = useGetStoryComments(storyId, {
    query: { queryKey: commentsKey, staleTime: 30_000, enabled: open },
  });

  const paragraphComments: StoryComment[] = (allComments ?? []).filter(
    (c) => c.paragraphIndex === paragraphIndex,
  );

  const addMutation = useAddStoryComment({
    mutation: {
      onSuccess: () => {
        setDraft("");
        queryClient.invalidateQueries({ queryKey: commentsKey });
        queryClient.invalidateQueries({
          queryKey: getGetParagraphCommentCountsQueryKey(storyId),
        });
        toast({ title: t("comments.posted") });
      },
      onError: () =>
        toast({ title: t("comments.postFailed"), variant: "destructive" }),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = (authorName ?? "").trim();
    if (!trimmed) {
      toast({
        title: t("comments.setPenNameTitle"),
        description: t("comments.setPenNameDesc"),
      });
      return;
    }
    const text = draft.trim();
    if (!text) return;
    addMutation.mutate({
      id: storyId,
      data: { authorName: trimmed, body: text, paragraphIndex },
    });
  };

  const isRu = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith(
    "ru",
  );
  const dateLocale = isRu ? ruLocale : undefined;
  const dateFmt = isRu ? "d MMM · HH:mm" : "MMM d · h:mm a";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={
            "h-6 w-6 relative " +
            (count > 0
              ? "opacity-100"
              : "opacity-0 group-hover/para:opacity-100 transition-opacity")
          }
          aria-label={t("comments.addToParagraphAria")}
          data-testid={`button-paragraph-comment-${paragraphIndex}`}
        >
          <MessageSquarePlus className="w-3.5 h-3.5" />
          {count > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center"
              data-testid={`badge-paragraph-comment-count-${paragraphIndex}`}
            >
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-80"
        data-testid={`popover-paragraph-comments-${paragraphIndex}`}
      >
        <h4 className="font-serif text-sm font-semibold mb-2">
          {t("comments.paragraphHeader")}
        </h4>
        <div className="max-h-56 overflow-y-auto pr-1 space-y-2 mb-3">
          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : paragraphComments.length === 0 ? (
            <p className="text-xs italic text-muted-foreground py-2">
              {t("comments.paragraphEmpty")}
            </p>
          ) : (
            paragraphComments.map((c) => (
              <div
                key={c.id}
                className="rounded border border-border/40 bg-card/40 p-2"
                data-testid={`paragraph-comment-${c.id}`}
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold">{c.authorName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(c.createdAt), dateFmt, {
                      locale: dateLocale,
                    })}
                  </span>
                </div>
                <p className="text-xs whitespace-pre-wrap leading-relaxed text-foreground/90">
                  {c.body}
                </p>
              </div>
            ))
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("comments.paragraphPlaceholder", {
              name: authorName?.trim() || "—",
            })}
            rows={2}
            maxLength={2000}
            className="bg-background text-sm"
            data-testid={`textarea-paragraph-comment-${paragraphIndex}`}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={
                addMutation.isPending ||
                !draft.trim() ||
                !authorName?.trim()
              }
              data-testid={`button-post-paragraph-comment-${paragraphIndex}`}
            >
              {addMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 mr-1" />
              )}
              {t("comments.post")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

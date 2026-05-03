import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetStoryComments,
  useAddStoryComment,
  useDeleteStoryComment,
  getGetStoryCommentsQueryKey,
  getGetStoryQueryKey,
  type StoryComment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import {
  MessageCircle,
  Loader2,
  Trash2,
  Send,
  CornerDownRight,
} from "lucide-react";
import { ReportButton } from "@/components/report-button";

type CommentNode = StoryComment & { children: CommentNode[] };

function buildTree(rows: StoryComment[]): CommentNode[] {
  const byId = new Map<number, CommentNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }
  const roots: CommentNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.parentId;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRecursive = (nodes: CommentNode[]) => {
    nodes.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    for (const n of nodes) {
      n.children.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      sortRecursive(n.children);
    }
  };
  sortRecursive(roots);
  return roots;
}

export function CommentsSection({ storyId }: { storyId: number }) {
  const { t, i18n } = useTranslation();
  const { authorName } = useAuthor();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [replyOpen, setReplyOpen] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  const queryKey = getGetStoryCommentsQueryKey(storyId);
  const { data: comments, isLoading } = useGetStoryComments(storyId, {
    query: { queryKey, staleTime: 30_000 },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
  };

  const addMutation = useAddStoryComment({
    mutation: {
      onSuccess: () => {
        setDraft("");
        setReplyDraft("");
        setReplyOpen(null);
        refresh();
        toast({ title: t("comments.posted") });
      },
      onError: () =>
        toast({ title: t("comments.postFailed"), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteStoryComment({
    mutation: {
      onSuccess: () => refresh(),
      onError: () =>
        toast({ title: t("comments.deleteFailed"), variant: "destructive" }),
    },
  });

  const requirePenName = () => {
    if (!authorName?.trim()) {
      toast({
        title: t("comments.setPenNameTitle"),
        description: t("comments.setPenNameDesc"),
      });
      return false;
    }
    return true;
  };

  const handleSubmitTop = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requirePenName()) return;
    const text = draft.trim();
    if (!text) return;
    addMutation.mutate({ id: storyId, data: { authorName, body: text } });
  };

  const handleSubmitReply = (parentId: number) => {
    if (!requirePenName()) return;
    const text = replyDraft.trim();
    if (!text) return;
    addMutation.mutate({
      id: storyId,
      data: { authorName, body: text, parentId },
    });
  };

  // Whole-story comments only — paragraph-anchored ones live in the
  // inline popover next to their paragraph and would duplicate the
  // discussion if shown here too.
  const wholeStoryComments = comments?.filter((c) => c.paragraphIndex == null) ?? [];
  const tree = buildTree(wholeStoryComments);
  const total = wholeStoryComments.length;

  const isRu = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("ru");
  const dateLocale = isRu ? ruLocale : undefined;
  const dateFmt = isRu ? "d MMM yyyy · HH:mm" : "MMM d, yyyy · h:mm a";

  const MAX_DEPTH = 1;
  const renderNode = (node: CommentNode, depth: number) => {
    const canReply = depth < MAX_DEPTH;
    const trimmedAuthor = authorName?.trim() ?? "";
    const mine = !!trimmedAuthor && node.authorName === trimmedAuthor;
    const isDeleting =
      deleteMutation.isPending &&
      (deleteMutation.variables as { commentId: number } | undefined)
        ?.commentId === node.id;
    return (
      <li
        key={node.id}
        className="rounded-lg border border-border/40 bg-card/40 p-4"
        style={depth > 0 ? { marginLeft: Math.min(depth, 3) * 24 } : undefined}
        data-testid={`comment-${node.id}`}
      >
        <div className="flex justify-between items-start gap-3 mb-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            {depth > 0 && (
              <CornerDownRight
                className="w-3.5 h-3.5 text-muted-foreground"
                aria-hidden
              />
            )}
            <span className="font-serif font-semibold text-foreground">
              {node.authorName}
            </span>
            <span className="text-xs text-muted-foreground">
              {format(new Date(node.createdAt), dateFmt, { locale: dateLocale })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ReportButton targetType="comment" targetId={node.id} size="icon" />
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
                    commentId: node.id,
                    params: { authorName },
                  })
                }
                aria-label={t("comments.deleteAria")}
                data-testid={`button-delete-comment-${node.id}`}
              >
                {isDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
          {node.body}
        </p>
        {canReply && (
          <div className="mt-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground hover:text-primary"
              onClick={() => {
                setReplyOpen(replyOpen === node.id ? null : node.id);
                setReplyDraft("");
              }}
              data-testid={`button-reply-${node.id}`}
            >
              {t("comments.reply")}
            </Button>
          </div>
        )}

        {replyOpen === node.id && (
          <div className="mt-3 space-y-2">
            <Textarea
              value={replyDraft}
              onChange={(e) => setReplyDraft(e.target.value)}
              placeholder={t("comments.replyTo", { name: node.authorName })}
              rows={2}
              maxLength={2000}
              className="bg-background"
              data-testid={`textarea-reply-${node.id}`}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReplyOpen(null);
                  setReplyDraft("");
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => handleSubmitReply(node.id)}
                disabled={!replyDraft.trim() || addMutation.isPending}
                data-testid={`button-post-reply-${node.id}`}
              >
                {addMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5 mr-1" />
                )}
                {t("comments.reply")}
              </Button>
            </div>
          </div>
        )}

        {node.children.length > 0 && (
          <ul className="mt-3 space-y-3">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section
      id="comments-section"
      className="container mx-auto px-4 mt-16 max-w-3xl"
      data-testid="comments-section"
    >
      <div className="border-t border-border/50 pt-12">
        <div className="flex items-center gap-2 mb-6">
          <MessageCircle className="w-5 h-5 text-primary" />
          <h2 className="font-serif text-2xl">
            {t("comments.readerComments")}
            <span className="text-muted-foreground ml-2 text-base">
              ({total})
            </span>
          </h2>
        </div>

        <form onSubmit={handleSubmitTop} className="mb-8 space-y-3">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              authorName
                ? t("comments.shareThoughts", { name: authorName })
                : t("comments.setPenNamePlaceholder")
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
              {t("comments.post")}
            </Button>
          </div>
        </form>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : tree.length === 0 ? (
          <p className="text-muted-foreground text-sm italic text-center py-8">
            {t("comments.noComments")}
          </p>
        ) : (
          <ul className="space-y-4">
            {tree.map((root) => renderNode(root, 0))}
          </ul>
        )}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useUpdateChapter,
  getGetChapterTreeQueryKey,
  getGetStoryQueryKey,
} from "@workspace/api-client-react";
import { useReadingTheme } from "@/components/theme-toggle";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storyId: number;
  chapterId: number;
  initialText: string;
  initialTitle?: string | null;
  showTitleField?: boolean;
};

export function ChapterEditDialog({
  open,
  onOpenChange,
  storyId,
  chapterId,
  initialText,
  initialTitle,
  showTitleField = true,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [theme] = useReadingTheme();
  const [text, setText] = useState(initialText);
  const [title, setTitle] = useState(initialTitle ?? "");

  // Reset draft when reopened against a different chapter or after a
  // server refresh updated the source-of-truth.
  useEffect(() => {
    if (open) {
      setText(initialText);
      setTitle(initialTitle ?? "");
    }
  }, [open, chapterId, initialText, initialTitle]);

  const update = useUpdateChapter({
    mutation: {
      onSuccess: () => {
        toast({ title: t("chapter.saved", "Chapter saved") });
        // Re-fetch tree (canonical chain may now render different
        // text) and the story (fullText is recomputed server-side).
        queryClient.invalidateQueries({
          queryKey: getGetChapterTreeQueryKey(storyId),
        });
        queryClient.invalidateQueries({
          queryKey: getGetStoryQueryKey(storyId),
        });
        onOpenChange(false);
      },
      onError: (err: Error) => {
        toast({
          title: t("chapter.saveFailed", "Could not save chapter"),
          description: err.message,
          variant: "destructive",
        });
      },
    },
  });

  const handleSave = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast({
        title: t("chapter.emptyText", "Chapter text cannot be empty"),
        variant: "destructive",
      });
      return;
    }
    update.mutate({
      id: storyId,
      chapterId,
      data: {
        text: trimmed,
        ...(showTitleField && title.trim() ? { title: title.trim() } : {}),
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("chapter.editTitle", "Edit chapter")}</DialogTitle>
          <DialogDescription>
            {t(
              "chapter.editDesc",
              "Markdown is supported. The story's reading text will refresh once you save.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {showTitleField && (
            <div className="space-y-2">
              <Label htmlFor="chapter-title-input">
                {t("chapter.titleLabel", "Chapter title")}
              </Label>
              <Input
                id="chapter-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("chapter.titlePlaceholder", "Optional title") ?? ""}
                maxLength={200}
                data-testid="input-chapter-title"
              />
            </div>
          )}
          <div className="space-y-2" data-color-mode={theme === "light" ? "light" : "dark"}>
            <Label>{t("chapter.textLabel", "Chapter text")}</Label>
            <MDEditor
              value={text}
              onChange={(v) => setText(v ?? "")}
              height={420}
              preview="live"
              textareaProps={{
                maxLength: 50000,
              }}
              data-testid="input-chapter-text"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
            data-testid="button-cancel-chapter-edit"
          >
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={update.isPending}
            data-testid="button-save-chapter-edit"
          >
            {update.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {t("common.save", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

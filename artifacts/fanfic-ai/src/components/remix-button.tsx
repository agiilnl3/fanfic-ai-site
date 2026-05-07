import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useRemixStory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { GitFork, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RemixButtonProps {
  storyId: number;
  authorName: string | null | undefined;
}

export function RemixButton({ storyId, authorName }: RemixButtonProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const remix = useRemixStory({
    mutation: {
      onSuccess: (story) => {
        toast({
          title: t("remix.created", "Remix created"),
          description: t(
            "remix.createdDesc",
            "Drafted as a fork. Generate the body to publish.",
          ),
        });
        setLocation(`/story/${story.id}`);
      },
      onError: () => {
        toast({
          title: t("remix.failed", "Could not remix"),
          description: t(
            "remix.failedDesc",
            "Try again in a moment.",
          ),
          variant: "destructive",
        });
      },
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!authorName?.trim()) {
      toast({
        title: t("remix.setPenNameTitle", "Set a pen name first"),
        description: t(
          "remix.setPenNameDesc",
          "Visit Settings to choose a pen name before remixing.",
        ),
      });
      return;
    }
    remix.mutate({ id: storyId, data: { authorName } });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={remix.isPending}
      className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50"
      data-testid={`button-remix-${storyId}`}
    >
      {remix.isPending ? (
        <Loader2 className="w-4 h-4 mr-1 animate-spin" />
      ) : (
        <GitFork className="w-4 h-4 mr-1" />
      )}
      {t("remix.button", "Remix")}
    </Button>
  );
}

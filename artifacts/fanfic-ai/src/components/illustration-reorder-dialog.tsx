import { useEffect, useState } from "react";
import { useReorderIllustrations, getGetStoryQueryKey, getGetIllustrationsQueryKey } from "@workspace/api-client-react";
import type { Illustration } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function IllustrationReorderDialog({
  storyId,
  illustrations,
  authorName,
  open,
  onOpenChange,
}: {
  storyId: number;
  illustrations: Illustration[];
  authorName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [order, setOrder] = useState<Illustration[]>(illustrations);

  useEffect(() => {
    if (open) setOrder([...illustrations].sort((a, b) => a.sectionIndex - b.sectionIndex));
  }, [open, illustrations]);

  const mutation = useReorderIllustrations({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
        queryClient.invalidateQueries({ queryKey: getGetIllustrationsQueryKey(storyId) });
        toast({ title: "Order saved" });
        onOpenChange(false);
      },
      onError: () => toast({ title: "Could not save order", variant: "destructive" }),
    },
  });

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
  };

  const save = () => {
    mutation.mutate({
      id: storyId,
      data: { order: order.map((i) => i.id), requesterAuthorName: authorName },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reorder illustrations</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
          {order.map((ill, idx) => (
            <li
              key={ill.id}
              className="flex items-center gap-3 p-2 rounded-lg border border-border/40 bg-card/50"
            >
              <img
                src={ill.imageUrl}
                alt={ill.prompt}
                className="w-16 h-16 object-cover rounded-md shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">#{idx + 1}</div>
                <div className="text-sm truncate">{ill.caption || ill.prompt.slice(0, 80)}</div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={idx === 0}
                  onClick={() => move(idx, -1)}
                  aria-label="Move up"
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={idx === order.length - 1}
                  onClick={() => move(idx, 1)}
                  aria-label="Move down"
                >
                  <ArrowDown className="w-4 h-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Save order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

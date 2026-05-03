import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCollaborators,
  useInviteCollaborator,
  useRevokeCollaborator,
  getListCollaboratorsQueryKey,
  getListCoAuthorsQueryKey,
  getGetStoryQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserPlus, X, Clock, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  storyId: number;
  trigger: React.ReactNode;
};

export function ManageCollaboratorsDialog({ storyId, trigger }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [handleDraft, setHandleDraft] = useState("");

  const listKey = getListCollaboratorsQueryKey(storyId);
  const { data, isLoading } = useListCollaborators(storyId, {
    query: { enabled: open && !!storyId, queryKey: listKey },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: listKey });
    queryClient.invalidateQueries({ queryKey: getListCoAuthorsQueryKey(storyId) });
    queryClient.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
  };

  const invite = useInviteCollaborator({
    mutation: {
      onSuccess: () => {
        setHandleDraft("");
        invalidateAll();
        toast({ title: t("collab.inviteSent") });
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : t("collab.inviteFailed");
        toast({ title: t("collab.inviteFailed"), description: message, variant: "destructive" });
      },
    },
  });

  const revoke = useRevokeCollaborator({
    mutation: {
      onSuccess: () => {
        invalidateAll();
        toast({ title: t("collab.revoked") });
      },
      onError: () =>
        toast({ title: t("collab.revokeFailed"), variant: "destructive" }),
    },
  });

  const collaborators = data?.collaborators ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("collab.manageTitle")}</DialogTitle>
          <DialogDescription>{t("collab.manageDesc")}</DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const handle = handleDraft.trim().replace(/^@/, "");
            if (!handle) return;
            invite.mutate({ id: storyId, data: { handle, role: "writer" } });
          }}
        >
          <Input
            value={handleDraft}
            onChange={(e) => setHandleDraft(e.target.value)}
            placeholder={t("collab.handlePlaceholder")}
            data-testid="input-collab-handle"
          />
          <Button
            type="submit"
            disabled={invite.isPending || !handleDraft.trim()}
            data-testid="button-collab-invite"
          >
            {invite.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4 mr-1" />
            )}
            {t("collab.invite")}
          </Button>
        </form>

        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {isLoading && (
            <div className="text-sm text-muted-foreground italic">
              {t("collab.loading")}
            </div>
          )}
          {!isLoading && collaborators.length === 0 && (
            <div className="text-sm text-muted-foreground italic">
              {t("collab.noneYet")}
            </div>
          )}
          {collaborators.map((c) => (
            <div
              key={c.userId}
              className="flex items-center justify-between gap-3 p-2 rounded-md border border-border/40"
              data-testid={`row-collab-${c.handle}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-muted" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {c.displayName}{" "}
                    <span className="text-muted-foreground">@{c.handle}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <StatusBadge status={c.status} />
                    <Badge variant="outline" className="text-[10px]">
                      {t(`collab.role_${c.role}`, c.role)}
                    </Badge>
                  </div>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate({ id: storyId, userId: c.userId })
                }
                aria-label={t("collab.revokeAria", { name: c.handle })}
                data-testid={`button-revoke-${c.handle}`}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === "accepted") {
    return (
      <Badge variant="secondary" className="text-[10px] gap-1">
        <Check className="w-3 h-3" /> {t("collab.status_accepted")}
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge variant="outline" className="text-[10px] gap-1">
        <Clock className="w-3 h-3" /> {t("collab.status_pending")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      {t(`collab.status_${status}`, status)}
    </Badge>
  );
}

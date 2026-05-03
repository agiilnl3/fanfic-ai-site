import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useCreateReport,
  type CreateReportBody,
} from "@workspace/api-client-react";
import { useAuthor } from "@/hooks/use-author";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Flag, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  targetType: CreateReportBody["targetType"];
  targetId: number;
  size?: "sm" | "icon";
};

export function ReportButton({ targetType, targetId, size = "sm" }: Props) {
  const { t } = useTranslation();
  const { authorName } = useAuthor();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const reportMutation = useCreateReport({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setReason("");
        toast({
          title: t("report.submitted"),
          description: t("report.submittedDesc"),
        });
      },
      onError: () => toast({ title: t("report.submitFailed"), variant: "destructive" }),
    },
  });

  const handleSubmit = () => {
    if (!authorName?.trim()) {
      toast({
        title: t("report.setPenNameTitle"),
        description: t("report.setPenNameDesc"),
      });
      return;
    }
    reportMutation.mutate({
      data: {
        targetType,
        targetId,
        reporterName: authorName,
        reason: reason.trim().slice(0, 500),
      },
    });
  };

  const targetLabel = t(`report.targets.${targetType}`, targetType);

  const Trigger =
    size === "icon" ? (
      <button
        type="button"
        aria-label={t("report.label")}
        className="text-muted-foreground hover:text-destructive transition-colors p-1"
        data-testid={`button-report-${targetType}-${targetId}`}
      >
        <Flag className="w-3.5 h-3.5" />
      </button>
    ) : (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-destructive"
        data-testid={`button-report-${targetType}-${targetId}`}
      >
        <Flag className="w-4 h-4 mr-1" />
        {t("report.label")}
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{Trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("report.title", { target: targetLabel })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("report.intro")}</p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("report.reasonPlaceholder")}
          rows={4}
          maxLength={500}
          data-testid="textarea-report-reason"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={reportMutation.isPending}
            data-testid="button-submit-report"
          >
            {reportMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Flag className="w-4 h-4 mr-2" />
            )}
            {t("report.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

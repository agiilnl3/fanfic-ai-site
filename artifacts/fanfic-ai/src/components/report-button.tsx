import { useState } from "react";
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
          title: "Report submitted",
          description: "Thanks — a moderator will review it.",
        });
      },
      onError: () => toast({ title: "Failed to submit report", variant: "destructive" }),
    },
  });

  const handleSubmit = () => {
    if (!authorName?.trim()) {
      toast({
        title: "Set your pen name first",
        description: "Reports include your pen name so moderators can contact you.",
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

  const Trigger =
    size === "icon" ? (
      <button
        type="button"
        aria-label="Report"
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
        Report
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{Trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {targetType}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Tell us what's wrong. Moderators will review the content and take action if needed.
        </p>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional, max 500 characters)"
          rows={4}
          maxLength={500}
          data-testid="textarea-report-reason"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
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
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

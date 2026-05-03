import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISS_KEY = "fanfic-ai-install-dismissed-at";
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export function InstallPrompt() {
  const { t } = useTranslation();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissedAt = Number(
      typeof window !== "undefined"
        ? window.localStorage.getItem(DISMISS_KEY) ?? "0"
        : "0",
    );
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt as EventListener);

    const onInstalled = () => {
      setVisible(false);
      setEvt(null);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt as EventListener);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible || !evt) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage may be disabled */
    }
  };

  const install = async () => {
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      if (choice.outcome !== "accepted") dismiss();
    } catch {
      dismiss();
    } finally {
      setEvt(null);
      setVisible(false);
    }
  };

  return (
    <div
      data-testid="install-prompt"
      className="fixed bottom-24 md:bottom-6 right-4 left-4 md:left-auto md:max-w-sm z-[60] rounded-xl border border-border/60 bg-background/95 backdrop-blur shadow-2xl p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4 fade-in duration-500"
    >
      <Download className="w-5 h-5 text-primary mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-serif font-semibold text-sm">
          {t("install.title", "Install FanFic AI")}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t(
            "install.body",
            "Add the app to your home screen for offline reading and a faster launch.",
          )}
        </p>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={install}>
            {t("install.cta", "Install")}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            {t("install.later", "Not now")}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="text-muted-foreground hover:text-foreground transition-colors"
        aria-label={t("install.dismiss", "Dismiss")}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

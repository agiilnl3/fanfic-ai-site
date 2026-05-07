import { useEffect, useState, useCallback } from "react";
import { Moon, Sun, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";

export type ReadingTheme = "dark" | "light" | "sepia";

const STORAGE_KEY = "ff-theme";

export function getStoredTheme(): ReadingTheme {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "sepia" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function applyTheme(theme: ReadingTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("ff-theme-change", { detail: theme }));
}

export function useReadingTheme(): [ReadingTheme, (t: ReadingTheme) => void] {
  const [theme, setThemeState] = useState<ReadingTheme>(() => getStoredTheme());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ReadingTheme>).detail;
      if (detail) setThemeState(detail);
    };
    window.addEventListener("ff-theme-change", onChange);
    return () => window.removeEventListener("ff-theme-change", onChange);
  }, []);

  const setTheme = useCallback((t: ReadingTheme) => {
    applyTheme(t);
    setThemeState(t);
  }, []);

  return [theme, setTheme];
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [theme, setTheme] = useReadingTheme();
  const Icon = theme === "light" ? Sun : theme === "sepia" ? BookOpen : Moon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label={t("theme.toggle", "Reading theme")}
          data-testid="button-theme-toggle"
          className={compact ? "h-9 w-9" : ""}
        >
          <Icon className="w-4 h-4" />
          {!compact && (
            <span className="ml-2 text-xs capitalize hidden lg:inline">
              {t(`theme.${theme}`, theme)}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("dark")} data-testid="theme-dark">
          <Moon className="w-4 h-4 mr-2" />
          {t("theme.dark", "Dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("light")} data-testid="theme-light">
          <Sun className="w-4 h-4 mr-2" />
          {t("theme.light", "Light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("sepia")} data-testid="theme-sepia">
          <BookOpen className="w-4 h-4 mr-2" />
          {t("theme.sepia", "Sepia")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

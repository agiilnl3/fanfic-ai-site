import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  useListStories,
  getListStoriesQueryKey,
} from "@workspace/api-client-react";
import {
  Sparkles,
  Library as LibraryIcon,
  Bookmark,
  PenTool,
  Settings,
  Wand2,
  Home,
  BookOpen,
} from "lucide-react";

type Action = {
  id: string;
  label: string;
  shortcut?: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
};

export function CommandPalette() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // ⌘K / Ctrl+K — toggle. Plain `k` should not trigger when focused on inputs.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Reset query whenever the dialog closes so the next open is fresh.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Lightweight client search: pull a slice of published stories once and
  // filter locally. The server already has a search endpoint, but for ⌘K
  // we want zero-latency typing. Refetched on dialog open via staleTime.
  const { data: stories } = useListStories(
    { status: "published" },
    {
      query: {
        queryKey: getListStoriesQueryKey({ status: "published" }),
        enabled: open,
        staleTime: 60_000,
      },
    },
  );

  const filteredStories = useMemo(() => {
    if (!stories) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? stories.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.authorName.toLowerCase().includes(q) ||
            s.genre.toLowerCase().includes(q),
        )
      : stories;
    return list.slice(0, 8);
  }, [stories, query]);

  const actions: Action[] = useMemo(
    () => [
      { id: "home", label: t("nav.home"), to: "/", icon: Home },
      {
        id: "create",
        label: t("commandPalette.newStory", "New story"),
        shortcut: "C",
        to: "/create",
        icon: Sparkles,
      },
      { id: "feed", label: t("nav.library"), to: "/feed", icon: LibraryIcon },
      {
        id: "library",
        label: t("nav.myLibrary", "My Library"),
        to: "/library",
        icon: Bookmark,
      },
      {
        id: "dashboard",
        label: t("nav.dashboard"),
        to: "/dashboard",
        icon: PenTool,
      },
      { id: "pricing", label: t("nav.pricing", "Pricing"), to: "/pricing", icon: Wand2 },
      {
        id: "settings",
        label: t("nav.settings", "Settings"),
        to: "/settings",
        icon: Settings,
      },
    ],
    [t],
  );

  const go = (to: string) => {
    setOpen(false);
    setLocation(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder={t("commandPalette.placeholder", "Search stories or jump to…")}
        value={query}
        onValueChange={setQuery}
        data-testid="command-palette-input"
      />
      <CommandList>
        <CommandEmpty>
          {t("commandPalette.empty", "No results.")}
        </CommandEmpty>

        <CommandGroup heading={t("commandPalette.actions", "Actions")}>
          {actions.map((a) => (
            <CommandItem
              key={a.id}
              value={`action ${a.label}`}
              onSelect={() => go(a.to)}
              data-testid={`command-action-${a.id}`}
            >
              <a.icon className="mr-2 h-4 w-4" />
              <span>{a.label}</span>
              {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
            </CommandItem>
          ))}
        </CommandGroup>

        {filteredStories.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("commandPalette.stories", "Stories")}>
              {filteredStories.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`story ${s.title} ${s.authorName} ${s.genre}`}
                  onSelect={() => go(`/story/${s.id}`)}
                  data-testid={`command-story-${s.id}`}
                >
                  <BookOpen className="mr-2 h-4 w-4 text-primary" />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{s.title}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {s.authorName} · {s.genre}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

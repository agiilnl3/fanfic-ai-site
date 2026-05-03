import React, { useState } from "react";
import {
  useGetChapterTree,
  useBranchChapter,
  useSetCanonicalChapter,
  useSetReadingProgress,
  getGetChapterTreeQueryKey,
  getGetStoryQueryKey,
  getGetReadingProgressQueryKey,
  type Chapter,
} from "@workspace/api-client-react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, GitBranch, Sparkles, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

interface Props {
  storyId: number;
  authorName: string;
  canEdit: boolean;
}

// Number of opening characters we show inline for each chapter when a
// reader expands an alternate path. Keeps the sidebar from ballooning
// past the visible viewport while still letting them sample the
// alternate storyline.
const PER_CHAPTER_PREVIEW_CHARS = 1500;

/**
 * Renders the canonical chapter chain plus, for each chapter that has
 * sibling alternates, a small "What if?" group letting the user preview
 * each fork and (when authorized) promote one to canonical or generate
 * brand-new alternates from the LLM.
 */
export function BranchesSidebar({ storyId, authorName, canEdit }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [seedByParent, setSeedByParent] = useState<Record<number, string>>({});
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const { data: tree, isLoading } = useGetChapterTree(storyId, {
    query: { enabled: !!storyId, queryKey: getGetChapterTreeQueryKey(storyId) },
  });

  const branch = useBranchChapter({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetChapterTreeQueryKey(storyId) });
        qc.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
        toast({ title: t("branches.generated", "Alternative branches generated") });
      },
      onError: () =>
        toast({
          title: t("branches.failed", "Could not generate branches"),
          variant: "destructive",
        }),
    },
  });

  // Lets a reader (no edit rights required) save their reading-progress
  // pointer onto a non-canonical chapter, so when they come back the
  // app remembers which alternate they were following — true
  // "reader-side branch switching" without rewriting the canon.
  const setProgress = useSetReadingProgress({
    mutation: {
      onSuccess: () => {
        // Invalidate reading-progress so the main reader re-renders the
        // chosen branch path immediately instead of after a refresh.
        qc.invalidateQueries({
          queryKey: getGetReadingProgressQueryKey(storyId, { authorName }),
        });
        toast({ title: t("branches.savedPath", "Saved your reading path") });
      },
      onError: () =>
        toast({
          title: t("branches.savePathFailed", "Could not save your path"),
          variant: "destructive",
        }),
    },
  });

  const setCanonical = useSetCanonicalChapter({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetChapterTreeQueryKey(storyId) });
        qc.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
        toast({ title: t("branches.switched", "Switched canonical branch") });
      },
      onError: () =>
        toast({
          title: t("branches.switchFailed", "Could not switch branch"),
          variant: "destructive",
        }),
    },
  });

  if (isLoading || !tree) {
    return (
      <aside className="rounded-xl border bg-muted/20 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("branches.loading", "Loading branches…")}
        </div>
      </aside>
    );
  }

  const all: Chapter[] = tree.chapters ?? [];
  const canonicalIds = new Set(tree.canonicalPath ?? []);
  const byParent = new Map<number | null, Chapter[]>();
  for (const c of all) {
    const arr = byParent.get(c.parentChapterId) ?? [];
    arr.push(c);
    byParent.set(c.parentChapterId, arr);
  }
  // Walk canonical chain to render row-by-row.
  const canonicalChapters: Chapter[] = (tree.canonicalPath ?? [])
    .map((id) => all.find((c) => c.id === id))
    .filter((c): c is Chapter => !!c);

  if (canonicalChapters.length === 0) {
    return (
      <aside className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
        {t("branches.empty", "No chapters yet.")}
      </aside>
    );
  }

  const handleBranch = (parentId: number) => {
    const seed = (seedByParent[parentId] ?? "").trim();
    branch.mutate({
      id: storyId,
      parentId,
      data: {
        authorName,
        seedPrompt: seed || undefined,
        count: 2,
      },
    });
  };

  const handleSwitch = (chapterId: number) => {
    setCanonical.mutate({ id: storyId, chapterId });
  };

  // Build the path leading up to a chapter (root → ... → chapter) so we
  // can show the reader the full storyline for an alternate branch, not
  // just the divergent fragment. The path follows parent pointers,
  // independent of is_canonical flags.
  const pathTo = (chapterId: number): Chapter[] => {
    const byId = new Map(all.map((c) => [c.id, c] as const));
    const out: Chapter[] = [];
    let cur: Chapter | undefined = byId.get(chapterId);
    while (cur) {
      out.unshift(cur);
      if (cur.parentChapterId == null) break;
      cur = byId.get(cur.parentChapterId);
    }
    return out;
  };
  const handleReadHere = (chapterId: number) => {
    if (!authorName?.trim()) {
      toast({
        title: t(
          "branches.signInToSave",
          "Pick a pen name to save your reading path",
        ),
        variant: "destructive",
      });
      return;
    }
    setProgress.mutate({
      id: storyId,
      data: {
        authorName,
        progress: 0,
        paragraphIndex: 0,
        chapterId,
      },
    });
  };

  return (
    <aside
      className="rounded-xl border bg-muted/10 p-4 space-y-4"
      data-testid="branches-sidebar"
    >
      <header className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="branches-toggle"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
          <GitBranch className="w-4 h-4 text-primary" />
          <h3 className="font-serif text-lg">
            {t("branches.title", "Branches")}
          </h3>
          <span className="text-xs text-muted-foreground">
            ({canonicalChapters.length})
          </span>
        </button>
      </header>

      {collapsed ? null : (
      <ol className="space-y-3">
        {canonicalChapters.map((c, idx) => {
          const siblings = (byParent.get(c.parentChapterId) ?? []).filter(
            (s) => s.id !== c.id,
          );
          return (
            <li key={c.id} className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-xs font-mono text-muted-foreground tabular-nums">
                  {idx + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {c.title || t("branches.untitledChapter", "Untitled chapter")}
                  </div>
                  {c.branchLabel && (
                    <div className="text-xs text-muted-foreground italic truncate">
                      {c.branchLabel}
                    </div>
                  )}
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {t("branches.canonical", "Canon")}
                </Badge>
              </div>

              {siblings.length > 0 && (
                <ul className="ml-6 space-y-1.5 border-l-2 border-dashed border-muted pl-3">
                  {siblings.map((s) => (
                    <li
                      key={s.id}
                      className="text-xs space-y-1"
                      data-testid={`branch-alt-${s.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3 h-3 text-amber-500 flex-shrink-0" />
                        <button
                          onClick={() =>
                            setPreviewing(previewing === s.id ? null : s.id)
                          }
                          className="text-left flex-1 min-w-0 hover:text-primary truncate"
                        >
                          {s.branchLabel ||
                            s.title ||
                            t("branches.altUnnamed", "Alternate")}
                        </button>
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px]"
                            disabled={
                              setCanonical.isPending ||
                              canonicalIds.has(s.id)
                            }
                            onClick={() => handleSwitch(s.id)}
                            data-testid={`branch-switch-${s.id}`}
                          >
                            <Check className="w-3 h-3 mr-1" />
                            {t("branches.makeCanon", "Use this")}
                          </Button>
                        )}
                      </div>
                      {previewing === s.id && (
                        <div
                          className="pl-5 space-y-3 max-h-[28rem] overflow-y-auto rounded border border-dashed border-muted bg-background/40 p-2"
                          data-testid={`branch-fulltext-${s.id}`}
                        >
                          {pathTo(s.id).map((step, stepIdx) => (
                            <div key={step.id} className="space-y-1">
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {stepIdx + 1}.{" "}
                                {step.title ||
                                  t(
                                    "branches.untitledChapter",
                                    "Untitled chapter",
                                  )}
                                {step.branchLabel ? ` — ${step.branchLabel}` : ""}
                              </div>
                              {step.text
                                .slice(0, PER_CHAPTER_PREVIEW_CHARS)
                                .split(/\n\n+/)
                                .filter((p) => p.trim().length > 0)
                                .map((para, i) => (
                                  <p
                                    key={i}
                                    className="text-xs text-foreground/80 leading-relaxed font-serif"
                                  >
                                    {para}
                                  </p>
                                ))}
                              {step.text.length >
                                PER_CHAPTER_PREVIEW_CHARS && (
                                <p className="text-[10px] text-muted-foreground italic">
                                  …{" "}
                                  {t(
                                    "branches.truncated",
                                    "(truncated for sidebar preview)",
                                  )}
                                </p>
                              )}
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs w-full"
                            disabled={setProgress.isPending}
                            onClick={() => handleReadHere(s.id)}
                            data-testid={`branch-read-here-${s.id}`}
                          >
                            {t(
                              "branches.readThisPath",
                              "Save this branch as my reading path",
                            )}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit && (
                <div className="ml-6 flex gap-1.5">
                  <Input
                    value={seedByParent[c.id] ?? ""}
                    onChange={(e) =>
                      setSeedByParent((p) => ({ ...p, [c.id]: e.target.value }))
                    }
                    placeholder={t(
                      "branches.seedPlaceholder",
                      "What if…? (optional)",
                    )}
                    className="h-7 text-xs"
                    disabled={branch.isPending}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs whitespace-nowrap"
                    disabled={branch.isPending}
                    onClick={() => handleBranch(c.id)}
                    data-testid={`branch-fork-${c.id}`}
                  >
                    {branch.isPending &&
                    (branch.variables as { parentId?: number } | undefined)
                      ?.parentId === c.id ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <GitBranch className="w-3 h-3 mr-1" />
                    )}
                    {t("branches.fork", "Fork")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      )}
    </aside>
  );
}

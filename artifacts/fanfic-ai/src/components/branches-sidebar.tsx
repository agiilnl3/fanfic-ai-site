import React, { useState } from "react";
import {
  useGetChapterTree,
  useBranchChapter,
  useSetCanonicalChapter,
  getGetChapterTreeQueryKey,
  getGetStoryQueryKey,
  type Chapter,
} from "@workspace/api-client-react";
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

  return (
    <aside
      className="rounded-xl border bg-muted/10 p-4 space-y-4"
      data-testid="branches-sidebar"
    >
      <header className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-primary" />
        <h3 className="font-serif text-lg">{t("branches.title", "Branches")}</h3>
      </header>

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
                        <p className="text-[11px] text-muted-foreground line-clamp-6 pl-5 leading-relaxed">
                          {s.text.slice(0, 600)}
                          {s.text.length > 600 ? "…" : ""}
                        </p>
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
    </aside>
  );
}

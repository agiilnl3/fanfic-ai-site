import React, { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { FollowButton } from "@/components/follow-button";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { LikeButton } from "@/components/like-button";
import { RepostButton } from "@/components/repost-button";
import { IllustrationReorderDialog } from "@/components/illustration-reorder-dialog";
import { CommentsSection } from "@/components/comments-section";
import { ParagraphCommentsPopover } from "@/components/paragraph-comments-popover";
import { ManageCollaboratorsDialog } from "@/components/manage-collaborators-dialog";
import { CharactersDialog } from "@/components/characters-dialog";
import { BranchesSidebar } from "@/components/branches-sidebar";
import {
  useGetStory,
  useUpdateStory,
  useDeleteIllustration,
  useGenerateIllustration,
  useRegenerateIllustration,
  useRegenerateStoryText,
  useRegenerateStorySection,
  useContinueStory,
  useListCoAuthors,
  useListStoryChapters,
  getGetStoryQueryKey,
  getGetIllustrationsQueryKey,
  getListCoAuthorsQueryKey,
  getListStoryChaptersQueryKey,
  getGetChapterTreeQueryKey,
  getGetStoryAudioUrl,
  getExportStoryPdfUrl,
  useGenerateStoryTrailer,
  useGetStoryTrailer,
  getGetStoryTrailerQueryKey,
  useRecordStoryView,
  useSetReadingProgress,
  useGetChapterTree,
  useGetReadingProgress,
  getGetReadingProgressQueryKey,
  useGetStoryAnalytics,
  useGetStoryTags,
  useGetParagraphCommentCounts,
  getGetParagraphCommentCountsQueryKey,
  useGetStorySeriesContext,
  useSetStoryTags,
  getGetStoryAnalyticsQueryKey,
  getGetStoryTagsQueryKey,
  getGetStorySeriesContextQueryKey,
} from "@workspace/api-client-react";
import { BookmarkButton } from "@/components/bookmark-button";
import { ReportButton } from "@/components/report-button";
import type { Illustration, Chapter } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuthor } from "@/hooks/use-author";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import {
  BookOpen, Share2, Globe, Lock, RefreshCw, Trash2, Loader2,
  RotateCcw, Pencil, Edit3, Check, X, Volume2, FileDown, BookPlus, MessageCircle, ArrowUpDown, Users, Film,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function StoryReading() {
  const { t, i18n } = useTranslation();
  const [, params] = useRoute("/story/:id");
  const storyId = Number(params?.id);
  const { authorName } = useAuthor();
  const { toast } = useToast();
  const isRu = (i18n.resolvedLanguage ?? i18n.language ?? "en").startsWith("ru");
  const dateLocale = isRu ? ruLocale : undefined;
  const headerDateFmt = isRu ? "d MMMM yyyy" : "MMMM do, yyyy";
  const queryClient = useQueryClient();
  const [regeneratingSectionIdx, setRegeneratingSectionIdx] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [promptEditingId, setPromptEditingId] = useState<number | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [reorderOpen, setReorderOpen] = useState(false);

  const { data: story, isLoading, error } = useGetStory(storyId, {
    query: {
      enabled: !!storyId,
      queryKey: getGetStoryQueryKey(storyId),
    },
  });

  // Per-paragraph comment counts power the inline "+N" badges next
  // to each paragraph. Cheap aggregate query, refreshed when the
  // user posts a paragraph comment.
  const { data: paragraphCommentCounts } = useGetParagraphCommentCounts(
    storyId,
    {
      query: {
        enabled: !!storyId,
        staleTime: 30_000,
        queryKey: getGetParagraphCommentCountsQueryKey(storyId),
      },
    },
  );
  const paragraphCommentCountMap = new Map<number, number>(
    (paragraphCommentCounts ?? []).map((r) => [r.paragraphIndex, r.count]),
  );

  const updateMutation = useUpdateStory();
  const deleteIllustrationMutation = useDeleteIllustration();
  const generateIllustrationMutation = useGenerateIllustration();
  const regenerateIllustrationMutation = useRegenerateIllustration();
  const regenerateStoryTextMutation = useRegenerateStoryText();
  const regenerateStorySectionMutation = useRegenerateStorySection();
  const continueStoryMutation = useContinueStory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetStoryQueryKey(storyId) });
        queryClient.invalidateQueries({ queryKey: getGetIllustrationsQueryKey(storyId) });
        queryClient.invalidateQueries({ queryKey: getListStoryChaptersQueryKey(storyId) });
        queryClient.invalidateQueries({ queryKey: getGetChapterTreeQueryKey(storyId) });
        toast({ title: t("story.newChapterAdded"), description: t("story.newChapterDesc") });
      },
      onError: () => toast({ title: t("story.failedContinue"), variant: "destructive" }),
    },
  });

  const [audioOpen, setAudioOpen] = useState(false);
  const audioUrl = getGetStoryAudioUrl(storyId);
  const pdfUrl = getExportStoryPdfUrl(storyId);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [trailerPolling, setTrailerPolling] = useState(false);
  const generateTrailerMutation = useGenerateStoryTrailer();
  const trailerQuery = useGetStoryTrailer(storyId, {
    query: {
      queryKey: getGetStoryTrailerQueryKey(storyId),
      enabled: trailerOpen,
      refetchInterval: trailerPolling ? 4000 : false,
    },
  });
  useEffect(() => {
    const s = trailerQuery.data?.status;
    if (s === "ready" || s === "failed") setTrailerPolling(false);
  }, [trailerQuery.data?.status]);
  const handleGenerateTrailer = () => {
    setTrailerOpen(true);
    if (trailerQuery.data?.status === "ready") return;
    setTrailerPolling(true);
    generateTrailerMutation.mutate(
      { id: storyId },
      {
        onSuccess: (res) => {
          queryClient.setQueryData(getGetStoryTrailerQueryKey(storyId), res);
          if (res.status === "ready" || res.status === "failed") {
            setTrailerPolling(false);
          }
        },
        onError: () => {
          setTrailerPolling(false);
          toast({
            title: t("story.trailerFailed", "Trailer failed"),
            description: t(
              "story.trailerFailedDesc",
              "Could not start trailer render.",
            ),
            variant: "destructive",
          });
        },
      },
    );
  };

  const { data: coAuthorData } = useListCoAuthors(storyId, {
    query: { enabled: !!storyId, queryKey: getListCoAuthorsQueryKey(storyId) },
  });
  const coAuthors = coAuthorData?.coAuthors ?? story?.coAuthors ?? [];
  const isPrimaryAuthor = !!authorName && story?.authorName === authorName;
  const isCoAuthor = !!authorName && coAuthors.includes(authorName);
  const isAuthor = isPrimaryAuthor || isCoAuthor;

  const { data: chapterAuthorData } = useListStoryChapters(storyId, {
    query: {
      enabled: !!storyId,
      queryKey: getListStoryChaptersQueryKey(storyId),
    },
  });
  const chapterAuthorByIndex = new Map<number, { userId: number; handle: string }>();
  for (const c of chapterAuthorData?.chapters ?? []) {
    chapterAuthorByIndex.set(c.chapterIndex, { userId: c.userId, handle: c.handle });
  }

  useEffect(() => {
    if (editMode && story?.fullText) {
      setEditText(story.fullText);
    }
  }, [editMode, story?.fullText]);

  // Record a single view per story per session.
  const recordView = useRecordStoryView();
  useEffect(() => {
    if (!storyId) return;
    const sessionKey = `viewed:${storyId}`;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(sessionKey)) {
      return;
    }
    recordView.mutate(
      {
        id: storyId,
        data: { viewerName: authorName?.trim() || null, completed: false },
      },
      {
        onSuccess: () => {
          try {
            sessionStorage.setItem(sessionKey, "1");
          } catch {
            /* ignore */
          }
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  // Persist reading progress while the user scrolls. We track both an
  // overall percentage *and* the index of the topmost visible paragraph
  // so the reader can resume at the exact spot they left off — the
  // percentage alone is too coarse on long stories (a 5% delta can be
  // ~30 paragraphs into a novella).
  const setProgress = useSetReadingProgress();

  // Fetch the chapters tree so we can stamp progress with the canonical
  // chapter id the reader is currently on. When the canonical path is
  // later rewritten (someone switches a branch), the stored chapterId
  // lets us still resume in the right chapter rather than the wrong
  // paragraph offset.
  const { data: chapterTree } = useGetChapterTree(storyId, {
    query: {
      enabled: !!storyId,
      queryKey: getGetChapterTreeQueryKey(storyId),
    },
  });
  // Ref-backed so the long-lived scroll handler always reads the
  // current chain (canonical or saved branch) without re-subscribing.
  const activeChainRef = React.useRef<
    Array<{ id: number; paraCount: number }>
  >([]);
  const chapterIdForParagraph = (paraIdx: number): number | null => {
    const chain = activeChainRef.current;
    let cum = 0;
    for (const c of chain) {
      cum += c.paraCount;
      if (paraIdx < cum) return c.id;
    }
    return chain.length > 0 ? chain[chain.length - 1].id : null;
  };
  const { data: savedProgress } = useGetReadingProgress(
    storyId,
    { authorName: authorName || "" },
    {
      query: {
        enabled: !!storyId && !!authorName?.trim(),
        queryKey: getGetReadingProgressQueryKey(storyId, {
          authorName: authorName || "",
        }),
        staleTime: Infinity,
      },
    },
  );

  // If the reader previously chose a non-canonical branch via
  // BranchesSidebar's "Save this branch as my reading path", we need
  // to *render* the path through that branch instead of the canonical
  // mirror in stories.full_text. Walk parent pointers from the saved
  // chapter back to the root, then append the canonical descendants of
  // that chapter so the reader doesn't run out of story at the
  // divergence point.
  const readerBranchText = React.useMemo<string | null>(() => {
    if (!chapterTree) return null;
    const savedChapterId = (savedProgress as { chapterId?: number | null } | undefined)
      ?.chapterId;
    if (savedChapterId == null) return null;
    const all = chapterTree.chapters ?? [];
    const canonicalSet = new Set(chapterTree.canonicalPath ?? []);
    if (canonicalSet.has(savedChapterId)) return null;
    const byId = new Map(all.map((c) => [c.id, c] as const));
    const prefix: typeof all = [];
    let cur = byId.get(savedChapterId);
    while (cur) {
      prefix.unshift(cur);
      if (cur.parentChapterId == null) break;
      cur = byId.get(cur.parentChapterId);
    }
    const childrenOf = new Map<number, typeof all>();
    for (const c of all) {
      if (c.parentChapterId == null) continue;
      const arr = childrenOf.get(c.parentChapterId) ?? [];
      arr.push(c);
      childrenOf.set(c.parentChapterId, arr);
    }
    let tail = byId.get(savedChapterId);
    const tailChain: typeof all = [];
    while (tail) {
      const next = (childrenOf.get(tail.id) ?? []).find((c) => c.isCanonical);
      if (!next) break;
      tailChain.push(next);
      tail = next;
    }
    const chain = [...prefix, ...tailChain];
    if (chain.length === 0) return null;
    return chain
      .map((c, i) =>
        i === 0
          ? c.text
          : `\n\n## ${c.title || `Chapter ${i + 1}`}\n\n${c.text}`,
      )
      .join("");
  }, [chapterTree, savedProgress]);

  // Active chain backing paragraph→chapterId mapping. Mirrors
  // readerBranchText: when the reader is on a saved non-canonical
  // branch we use that branch's chain so progress saves stamp
  // chapterIds from the branch (preserving their selection across
  // scroll updates) instead of the canonical chain.
  const activeChain = React.useMemo<
    Array<{ id: number; paraCount: number }>
  >(() => {
    if (!chapterTree) return [];
    const all = chapterTree.chapters ?? [];
    const byId = new Map(all.map((c) => [c.id, c] as const));
    const savedChapterId = (savedProgress as { chapterId?: number | null } | undefined)
      ?.chapterId;
    const canonicalSet = new Set(chapterTree.canonicalPath ?? []);
    let chainIds: number[];
    if (savedChapterId != null && !canonicalSet.has(savedChapterId)) {
      const prefix: number[] = [];
      let cur = byId.get(savedChapterId);
      while (cur) {
        prefix.unshift(cur.id);
        if (cur.parentChapterId == null) break;
        cur = byId.get(cur.parentChapterId);
      }
      const childrenOf = new Map<number, Chapter[]>();
      for (const c of all) {
        if (c.parentChapterId == null) continue;
        const arr = childrenOf.get(c.parentChapterId) ?? [];
        arr.push(c);
        childrenOf.set(c.parentChapterId, arr);
      }
      let tail = byId.get(savedChapterId);
      const tailChain: number[] = [];
      while (tail) {
        const next = (childrenOf.get(tail.id) ?? []).find((c) => c.isCanonical);
        if (!next) break;
        tailChain.push(next.id);
        tail = next;
      }
      chainIds = [...prefix, ...tailChain];
    } else {
      chainIds = chapterTree.canonicalPath ?? [];
    }
    return chainIds
      .map((id) => byId.get(id))
      .filter((c): c is Chapter => !!c)
      .map((c) => ({
        id: c.id,
        paraCount: c.text.split(/\n\n+/).filter((p) => p.trim()).length,
      }));
  }, [chapterTree, savedProgress]);

  React.useEffect(() => {
    activeChainRef.current = activeChain;
  }, [activeChain]);

  // Resume scroll position once both the saved progress and the rendered
  // paragraphs exist. We only fire once per (storyId, authorName) so a
  // late save doesn't yank the reader back up the page.
  const [resumed, setResumed] = useState<string | null>(null);
  useEffect(() => {
    // Wait until *all four* prerequisites exist before deciding what to
    // do: storyId, pen-name, the rendered fullText, AND a resolved
    // saved-progress object. Earlier we short-circuited when
    // savedProgress was still undefined and marked the page "resumed",
    // which meant the late-arriving cursor never got a chance to scroll.
    if (
      !storyId ||
      !authorName?.trim() ||
      !story?.fullText ||
      savedProgress === undefined
    )
      return;
    const key = `${storyId}:${authorName}`;
    if (resumed === key) return;
    const idx = savedProgress?.paragraphIndex ?? 0;
    if (!idx || idx <= 0) {
      setResumed(key);
      return;
    }
    // Defer one frame so the paragraph DOM nodes are mounted.
    const t = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-paragraph-index="${idx}"]`,
      );
      if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top, behavior: "auto" });
      }
      setResumed(key);
    }, 80);
    return () => window.clearTimeout(t);
  }, [storyId, authorName, story?.fullText, savedProgress, resumed]);

  useEffect(() => {
    if (!storyId || !authorName?.trim()) return;
    const MIN_INTERVAL_MS = 3000;
    let lastSentAt = 0;
    let lastSentPct = 0;
    let lastSentPara = -1;
    let pending: { pct: number; paraIdx: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (pending == null) return;
      const { pct, paraIdx } = pending;
      pending = null;
      lastSentAt = Date.now();
      lastSentPct = pct;
      lastSentPara = paraIdx;
      const chapterId = chapterIdForParagraph(paraIdx);
      setProgress.mutate({
        id: storyId,
        data: {
          authorName,
          progress: pct,
          paragraphIndex: paraIdx,
          ...(chapterId != null ? { chapterId } : {}),
        },
      });
    };
    const computeTopParagraphIndex = (): number => {
      const nodes = document.querySelectorAll<HTMLElement>(
        "[data-paragraph-index]",
      );
      // Find the last paragraph whose top has scrolled above the
      // viewport's upper third — that is the "anchor" the reader is on.
      const anchor = window.innerHeight / 3;
      let best = 0;
      for (const n of Array.from(nodes)) {
        const top = n.getBoundingClientRect().top;
        if (top <= anchor) {
          const i = Number(n.dataset.paragraphIndex);
          if (Number.isFinite(i) && i > best) best = i;
        } else {
          break;
        }
      }
      return best;
    };
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const pct = Math.max(
        0,
        Math.min(100, Math.round((scrollTop / max) * 100)),
      );
      const paraIdx = computeTopParagraphIndex();
      const pctDelta = Math.abs(pct - lastSentPct);
      const paraDelta = Math.abs(paraIdx - lastSentPara);
      if (pctDelta < 5 && paraDelta < 3 && pct < 95) return;
      pending = { pct, paraIdx };
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= MIN_INTERVAL_MS) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        flush();
      } else if (!timer) {
        timer = setTimeout(flush, MIN_INTERVAL_MS - elapsed);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, authorName]);

  const { data: analytics } = useGetStoryAnalytics(
    storyId,
    { authorName: authorName || "" },
    {
      query: {
        enabled: !!storyId && isAuthor,
        queryKey: getGetStoryAnalyticsQueryKey(storyId, {
          authorName: authorName || "",
        }),
      },
    },
  );

  const { data: storyTags } = useGetStoryTags(storyId, {
    query: { enabled: !!storyId, queryKey: getGetStoryTagsQueryKey(storyId) },
  });
  const { data: seriesContext } = useGetStorySeriesContext(storyId, {
    query: {
      enabled: !!storyId,
      queryKey: getGetStorySeriesContextQueryKey(storyId),
    },
  });
  const [tagDraft, setTagDraft] = useState("");
  useEffect(() => {
    if (storyTags) {
      setTagDraft(storyTags.map((t) => t.label).join(", "));
    }
  }, [storyTags]);
  const setTagsMutation = useSetStoryTags({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetStoryTagsQueryKey(storyId),
        });
        toast({ title: t("story.tagsSaved") });
      },
      onError: () => toast({ title: t("story.tagsSaveFailed"), variant: "destructive" }),
    },
  });

  const handleEnterEdit = () => setEditMode(true);
  const handleCancelEdit = () => setEditMode(false);

  const handleSaveEdit = () => {
    if (!story) return;
    updateMutation.mutate(
      { id: story.id, data: { fullText: editText } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), { ...story, ...updated });
          setEditMode(false);
          toast({ title: t("story.saved"), description: t("story.savedDesc") });
        },
        onError: () => {
          toast({ title: t("story.saveFailed"), description: t("story.saveFailedDesc"), variant: "destructive" });
        },
      },
    );
  };

  const togglePublish = () => {
    if (!story) return;
    const newStatus = story.status === "published" ? "draft" : "published";
    updateMutation.mutate(
      { id: story.id, data: { status: newStatus } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), { ...story, ...updated });
          toast({
            title: newStatus === "published" ? t("story.published") : t("story.unpublished"),
            description:
              newStatus === "published"
                ? t("story.publishedDesc")
                : t("story.unpublishedDesc"),
          });
        },
      },
    );
  };

  const handleRegenerateStoryText = () => {
    if (!story) return;
    regenerateStoryTextMutation.mutate(
      { id: story.id },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), { ...story, ...updated });
          toast({ title: t("story.rewritten"), description: t("story.rewrittenDesc") });
        },
        onError: () => {
          toast({ title: t("story.regenFailed"), description: t("story.regenTextFailedDesc"), variant: "destructive" });
        },
      },
    );
  };

  const handleRegenerateIllustration = (ill: Illustration, promptOverride?: string) => {
    if (!story) return;
    regenerateIllustrationMutation.mutate(
      {
        id: story.id,
        illustrationId: ill.id,
        data: promptOverride ? { promptOverride } : {},
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), (old: typeof story | undefined) => {
            if (!old) return old;
            return {
              ...old,
              illustrations: old.illustrations.map((i) => (i.id === ill.id ? updated : i)),
              coverImageUrl: ill.sectionIndex === 0 ? updated.imageUrl : old.coverImageUrl,
            };
          });
          setPromptEditingId(null);
          toast({ title: t("story.illRegenerated"), description: t("story.illRegeneratedDesc") });
        },
        onError: () => {
          toast({ title: t("story.regenFailed"), description: t("story.regenIllFailedDesc"), variant: "destructive" });
        },
      },
    );
  };

  const openPromptEditor = (ill: Illustration) => {
    setPromptDraft(ill.prompt);
    setPromptEditingId(ill.id);
  };

  const handleDeleteIllustration = (ill: Illustration) => {
    if (!story) return;
    deleteIllustrationMutation.mutate(
      { id: story.id, illustrationId: ill.id },
      {
        onSuccess: () => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), (old: typeof story | undefined) => {
            if (!old) return old;
            return { ...old, illustrations: old.illustrations.filter((i) => i.id !== ill.id) };
          });
          queryClient.invalidateQueries({ queryKey: getGetIllustrationsQueryKey(story.id) });
          toast({ title: t("story.illRemoved") });
        },
      },
    );
  };

  const handleAddIllustration = (sectionIndex: number, sectionText: string) => {
    if (!story) return;
    generateIllustrationMutation.mutate(
      { id: story.id, data: { sectionIndex, sectionText } },
      {
        onSuccess: (newIll) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), (old: typeof story | undefined) => {
            if (!old) return old;
            return { ...old, illustrations: [...old.illustrations, newIll] };
          });
          toast({ title: t("story.illAdded") });
        },
        onError: () => {
          toast({ title: t("story.failed"), description: t("story.illGenFailedDesc"), variant: "destructive" });
        },
      },
    );
  };

  const handleRegenerateSection = (sectionIndex: number, currentSectionText: string) => {
    if (!story) return;
    setRegeneratingSectionIdx(sectionIndex);
    regenerateStorySectionMutation.mutate(
      { id: story.id, sectionIndex, data: { currentSectionText } },
      {
        onSuccess: (result) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), (old: typeof story | undefined) => {
            if (!old) return old;
            const paragraphs = (old.fullText ?? "").split(/\n\n+/);
            const numSections = Math.max(4, illustrations.length);
            const paragraphsPerSection = Math.max(1, Math.ceil(paragraphs.length / numSections));
            const startIdx = sectionIndex * paragraphsPerSection;
            const endIdx = Math.min(startIdx + paragraphsPerSection, paragraphs.length);
            const newParagraphs = [...paragraphs];
            newParagraphs.splice(startIdx, endIdx - startIdx, ...result.rewrittenText.split(/\n\n+/));
            const updatedIllustrations = result.illustration
              ? old.illustrations.map((i) =>
                  i.sectionIndex === sectionIndex ? result.illustration! : i,
                ).concat(
                  old.illustrations.some((i) => i.sectionIndex === sectionIndex) ? [] : [result.illustration],
                )
              : old.illustrations;
            return {
              ...old,
              fullText: newParagraphs.join("\n\n"),
              illustrations: updatedIllustrations,
              coverImageUrl:
                sectionIndex === 0 && result.illustration
                  ? result.illustration.imageUrl
                  : old.coverImageUrl,
            };
          });
          toast({ title: t("story.sectionRewritten") });
        },
        onError: () => {
          toast({ title: t("story.failed"), description: t("story.regenSectionFailedDesc"), variant: "destructive" });
        },
        onSettled: () => setRegeneratingSectionIdx(null),
      },
    );
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-4xl">
          <div className="space-y-8 animate-pulse">
            <Skeleton className="h-[400px] w-full rounded-2xl" />
            <div className="space-y-4 text-center">
              <Skeleton className="h-12 w-3/4 mx-auto" />
              <Skeleton className="h-6 w-1/4 mx-auto" />
            </div>
            <div className="space-y-4 pt-12">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !story) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-32 text-center">
          <BookOpen className="w-16 h-16 mx-auto mb-6 text-muted-foreground/30" />
          <h1 className="text-2xl font-serif mb-2">{t("story.notFound")}</h1>
          <p className="text-muted-foreground">{t("story.notFoundDesc")}</p>
        </div>
      </Layout>
    );
  }

  // Prefer the reader's saved-branch text over the canonical mirror so
  // that "Save this branch as my reading path" actually rewires the
  // main reader, not just the sidebar preview. Falls back to fullText
  // for canonical readers and stories without a chapter tree yet.
  const renderedStoryText = readerBranchText ?? story.fullText ?? "";
  const paragraphs = renderedStoryText.split(/\n\n+/).filter((p) => p.trim());

  const illustrations = [...(story.illustrations || [])].sort(
    (a, b) => a.sectionIndex - b.sectionIndex,
  );

  const numSections = illustrations.length > 0
    ? illustrations[illustrations.length - 1].sectionIndex + 1
    : 1;

  const illBySection = new Map<number, Illustration>();
  for (const ill of illustrations) {
    illBySection.set(ill.sectionIndex, ill);
  }

  const desiredSections = Math.max(
    numSections,
    Math.min(4, Math.max(1, paragraphs.length)),
  );

  const insertAfterParagraph = new Map<number, number>();
  for (let s = 0; s < desiredSections; s++) {
    if (paragraphs.length === 0) break;
    const paraIdx = Math.min(
      Math.floor(((s + 1) * paragraphs.length) / desiredSections) - 1,
      paragraphs.length - 1,
    );
    const key = Math.max(0, paraIdx);
    if (!insertAfterParagraph.has(key)) {
      insertAfterParagraph.set(key, s);
    }
  }
  for (const ill of illustrations) {
    const s = ill.sectionIndex;
    const paraIdx = Math.min(
      Math.floor(((s + 1) * paragraphs.length) / desiredSections) - 1,
      paragraphs.length - 1,
    );
    insertAfterParagraph.set(Math.max(0, paraIdx), s);
  }

  const paragraphSectionIndex = (paraIdx: number): number =>
    Math.floor((paraIdx * numSections) / Math.max(paragraphs.length, 1));

  const isRegeneratingIll = (ill: Illustration) =>
    regenerateIllustrationMutation.isPending &&
    (regenerateIllustrationMutation.variables as { illustrationId: number } | undefined)?.illustrationId === ill.id;

  // Walk paragraphs once to compute the chapter index of each paragraph.
  // Chapter 0 = original story body; each `## Title` paragraph opens
  // chapter N+1 (matches the backend's `## ` heading count in /continue).
  const paragraphChapterIndex: number[] = [];
  {
    let chapter = 0;
    for (const p of paragraphs) {
      if (p.startsWith("## ")) chapter += 1;
      paragraphChapterIndex.push(chapter);
    }
  }

  const elements: React.ReactNode[] = [];
  paragraphs.forEach((p, i) => {
    const thisSectionIdx = paragraphSectionIndex(i);
    const isRegenSection = regeneratingSectionIdx === thisSectionIdx;
    const isChapterHeading = p.startsWith("## ");
    const chapterIdx = paragraphChapterIndex[i];
    const chapterAuthor = chapterAuthorByIndex.get(chapterIdx);
    const headingText = isChapterHeading ? p.replace(/^##\s+/, "") : "";

    elements.push(
      <div
        key={`p-wrap-${i}`}
        data-paragraph-index={i}
        className={`relative group/para ${isRegenSection ? "opacity-40 pointer-events-none" : ""}`}
      >
        {isAuthor && !editMode && !isChapterHeading && (
          <div className="absolute -left-10 top-1 opacity-0 group-hover/para:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              title={t("story.rewriteSectionTitle")}
              disabled={regenerateStorySectionMutation.isPending || isRegenSection}
              onClick={() => handleRegenerateSection(thisSectionIdx, p)}
            >
              {isRegenSection ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Pencil className="w-3 h-3" />
              )}
            </Button>
          </div>
        )}
        {!editMode && !isChapterHeading && (
          // Inline paragraph comments. Sits on the right gutter so
          // it never collides with the author's rewrite pencil on
          // the left. Visible-on-hover (or always-visible when this
          // paragraph already has comments — see component).
          <div className="absolute -right-10 top-1">
            <ParagraphCommentsPopover
              storyId={story.id}
              paragraphIndex={i}
              count={paragraphCommentCountMap.get(i) ?? 0}
            />
          </div>
        )}
        {isChapterHeading ? (
          <div className="mt-12 mb-6">
            <h2
              className="font-serif text-3xl md:text-4xl"
              data-testid={`chapter-heading-${chapterIdx}`}
            >
              {headingText}
            </h2>
            {chapterAuthor && chapterAuthor.handle !== story.authorName && (
              <div
                className="mt-2 text-sm text-muted-foreground italic"
                data-testid={`chapter-byline-${chapterIdx}`}
              >
                {t("story.chapterBy")}{" "}
                <Link
                  href={`/author/${encodeURIComponent(chapterAuthor.handle)}`}
                  className="hover:text-primary hover:underline"
                >
                  @{chapterAuthor.handle}
                </Link>
                <Badge
                  variant="outline"
                  className="ml-2 text-[10px] uppercase tracking-wider"
                >
                  {t("collab.coAuthorBadge")}
                </Badge>
              </div>
            )}
          </div>
        ) : (
          <p className="mb-6 leading-relaxed">{p}</p>
        )}
      </div>,
    );

    const sectionForIll = insertAfterParagraph.get(i);
    if (sectionForIll !== undefined) {
      const ill = illBySection.get(sectionForIll);
      if (ill) {
        elements.push(
          <figure key={`ill-${ill.id}`} className="my-12 relative group">
            <div className="rounded-xl overflow-hidden book-shadow relative">
              {isRegeneratingIll(ill) ? (
                <div className="w-full h-64 flex items-center justify-center bg-muted/30">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">{t("story.paintingScene")}</span>
                </div>
              ) : (
                <img
                  src={ill.imageUrl}
                  alt={ill.prompt}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-auto object-cover"
                />
              )}
              <div className="absolute inset-0 ring-1 ring-inset ring-white/10 pointer-events-none rounded-xl" />
            </div>
            {isAuthor && !editMode && promptEditingId !== ill.id && (
              <div className="mt-2 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs h-7"
                  disabled={isRegeneratingIll(ill)}
                  onClick={() => handleRegenerateIllustration(ill)}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  {t("story.regenerate")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  disabled={isRegeneratingIll(ill)}
                  onClick={() => openPromptEditor(ill)}
                >
                  <Edit3 className="w-3 h-3 mr-1" />
                  {t("story.editPrompt")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs h-7"
                  disabled={deleteIllustrationMutation.isPending}
                  onClick={() => handleDeleteIllustration(ill)}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  {t("story.remove")}
                </Button>
              </div>
            )}
            {isAuthor && promptEditingId === ill.id && (
              <div className="mt-3 p-3 rounded-lg border bg-muted/30 space-y-2">
                <div className="text-xs text-muted-foreground font-medium">
                  {t("story.editIllPrompt")}
                </div>
                <Textarea
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  rows={4}
                  className="text-sm font-mono"
                  placeholder={t("story.scenePlaceholder")}
                  disabled={isRegeneratingIll(ill)}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    disabled={isRegeneratingIll(ill)}
                    onClick={() => setPromptEditingId(null)}
                  >
                    <X className="w-3 h-3 mr-1" />
                    {t("story.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={isRegeneratingIll(ill) || !promptDraft.trim()}
                    onClick={() => handleRegenerateIllustration(ill, promptDraft.trim())}
                  >
                    {isRegeneratingIll(ill) ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Check className="w-3 h-3 mr-1" />
                    )}
                    {t("story.regenerateWithPrompt")}
                  </Button>
                </div>
              </div>
            )}
            {ill.caption && (
              <figcaption className="text-center text-muted-foreground text-sm italic mt-4 px-8">
                {ill.caption}
              </figcaption>
            )}
          </figure>,
        );
      } else if (isAuthor && !editMode) {
        const sectionText = paragraphs.slice(Math.max(0, i - 1), i + 2).join("\n\n");
        elements.push(
          <div key={`add-ill-${i}`} className="my-8 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              className="border-dashed text-xs opacity-50 hover:opacity-100 transition-opacity"
              disabled={generateIllustrationMutation.isPending}
              onClick={() => handleAddIllustration(sectionForIll, sectionText)}
            >
              {generateIllustrationMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3 mr-1" />
              )}
              {t("story.addIllHere")}
            </Button>
          </div>,
        );
      }
    }
  });

  return (
    <Layout>
      <Seo
        title={story.title}
        description={story.summary ?? t("story.seoFallback", { genre: t(`genres.${story.genre}`, story.genre), author: story.authorName })}
        storyId={story.id}
        type="article"
        author={story.authorName}
        publishedTime={story.createdAt}
      />
      <article className="pb-32 animate-in fade-in duration-700">
        <header className="relative w-full h-[50vh] min-h-[400px] flex items-end justify-center pb-16 overflow-hidden">
          {story.coverImageUrl ? (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${story.coverImageUrl})` }}
            />
          ) : (
            <div className="absolute inset-0 bg-secondary" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/20" />
          <div className="relative z-10 container mx-auto px-4 max-w-4xl text-center">
            <Badge className="mb-6 bg-primary/20 text-primary border-primary/30 backdrop-blur-md">
              {t(`genres.${story.genre}`, story.genre)} • {t(`artStyles.${story.artStyle}`, story.artStyle)}
            </Badge>
            <h1 className="font-serif text-5xl md:text-7xl font-bold tracking-tight mb-6 glow-text text-white drop-shadow-lg">
              {story.title}
            </h1>
            <p className="text-xl text-white/80 italic font-serif">
              {t("story.byLabel")}{" "}
              <Link
                href={`/author/${encodeURIComponent(story.authorName)}`}
                className="hover:text-primary hover:underline transition-colors"
              >
                {story.authorName}
              </Link>
              {coAuthors.length > 0 && (
                <span className="text-white/60"> &amp; {coAuthors.join(", ")}</span>
              )}
            </p>
            <div className="mt-3 flex justify-center">
              <FollowButton
                authorName={story.authorName}
                size="sm"
                variant="outline"
                className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50"
                showCount
              />
            </div>
            <p className="text-sm text-white/50 mt-4 uppercase tracking-widest">
              {format(new Date(story.createdAt), headerDateFmt, { locale: dateLocale })}
            </p>
            <div className="mt-6 flex justify-center items-center gap-3">
              <LikeButton storyId={story.id} size="lg" variant="outline" className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50 hover:text-rose-400 px-4" />
              <RepostButton storyId={story.id} size="default" />
              <a
                href="#comments-section"
                className="inline-flex items-center gap-2 px-4 h-10 rounded-md bg-background/30 backdrop-blur-md border border-white/20 text-white hover:bg-background/50 transition-colors text-sm"
                data-testid="link-comments"
              >
                <MessageCircle className="w-4 h-4" />
                <span className="tabular-nums">{story.commentCount}</span>
              </a>
              <BookmarkButton storyId={story.id} />
              {!isAuthor && (
                <ReportButton targetType="story" targetId={story.id} />
              )}
            </div>
            {seriesContext?.seriesId && (
              <div
                className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm text-white/80"
                data-testid="series-nav"
              >
                {seriesContext.prevStoryId ? (
                  <Link href={`/story/${seriesContext.prevStoryId}`}>
                    <Badge
                      variant="outline"
                      className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50 cursor-pointer"
                      data-testid="link-series-prev"
                    >
                      ← {t("story.previous")}
                    </Badge>
                  </Link>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-background/10 border-white/10 text-white/40"
                  >
                    ← {t("story.previous")}
                  </Badge>
                )}
                <Link href={`/series/${seriesContext.seriesId}`}>
                  <Badge
                    variant="outline"
                    className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50 cursor-pointer"
                    data-testid="link-series-home"
                  >
                    {seriesContext.seriesTitle}
                    {seriesContext.totalStories
                      ? ` · ${t("story.partOf", { current: (seriesContext.position ?? 0) + 1, total: seriesContext.totalStories })}`
                      : ""}
                  </Badge>
                </Link>
                {seriesContext.nextStoryId ? (
                  <Link href={`/story/${seriesContext.nextStoryId}`}>
                    <Badge
                      variant="outline"
                      className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50 cursor-pointer"
                      data-testid="link-series-next"
                    >
                      {t("story.next")} →
                    </Badge>
                  </Link>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-background/10 border-white/10 text-white/40"
                  >
                    {t("story.next")} →
                  </Badge>
                )}
              </div>
            )}
            {(storyTags ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {(storyTags ?? []).map((t) => (
                  <Link
                    key={t.id}
                    href={`/feed?tag=${encodeURIComponent(t.slug)}`}
                  >
                    <Badge
                      variant="outline"
                      className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50 cursor-pointer"
                    >
                      #{t.label}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </header>

        {isPrimaryAuthor && (
          <div className="container mx-auto px-4 max-w-4xl mt-6 relative z-20">
            <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-serif text-sm uppercase tracking-wider text-muted-foreground">
                  {t("story.coAuthors")}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {coAuthors.length === 0
                    ? t("story.noCoAuthors")
                    : t("collab.acceptedSummary", {
                        names: coAuthors.join(", "),
                        count: coAuthors.length,
                      })}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <ManageCollaboratorsDialog
                  storyId={story.id}
                  trigger={
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="button-manage-collaborators"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      {t("collab.manageButton")}
                    </Button>
                  }
                />
                {authorName && (
                  <CharactersDialog
                    mode="story"
                    ownerHandle={authorName}
                    storyId={story.id}
                    seriesId={seriesContext?.seriesId ?? null}
                    trigger={
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="button-manage-characters"
                      >
                        <Users className="w-4 h-4 mr-2" />
                        {t("characters.button", "Characters")}
                      </Button>
                    }
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {isAuthor && (
          <div className="container mx-auto px-4 max-w-4xl mt-4 relative z-20 flex justify-end gap-2 flex-wrap">
            {editMode ? (
              <>
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-full shadow-lg"
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  {t("story.saveChanges")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full shadow-lg backdrop-blur-md"
                  onClick={handleCancelEdit}
                  disabled={updateMutation.isPending}
                >
                  <X className="w-4 h-4 mr-2" />
                  {t("story.cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full shadow-lg backdrop-blur-md"
                  onClick={handleEnterEdit}
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  {t("story.editText")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full shadow-lg backdrop-blur-md"
                  onClick={handleRegenerateStoryText}
                  disabled={regenerateStoryTextMutation.isPending}
                >
                  {regenerateStoryTextMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4 mr-2" />
                  )}
                  {t("story.rewriteStory")}
                </Button>
                <Button
                  variant={story.status === "published" ? "outline" : "default"}
                  size="sm"
                  className="rounded-full shadow-lg backdrop-blur-md"
                  onClick={togglePublish}
                  disabled={updateMutation.isPending}
                >
                  {story.status === "published" ? (
                    <><Lock className="w-4 h-4 mr-2" /> {t("story.makeDraft")}</>
                  ) : (
                    <><Globe className="w-4 h-4 mr-2" /> {t("story.publishToFeed")}</>
                  )}
                </Button>
              </>
            )}
          </div>
        )}

        {isAuthor && (
          <div className="container mx-auto px-4 max-w-4xl mt-6 relative z-20">
            <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur p-4 space-y-3">
              <h3 className="font-serif text-sm uppercase tracking-wider text-muted-foreground">
                {t("story.tags")}
              </h3>
              <Textarea
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                rows={2}
                placeholder={t("story.tagsPlaceholder")}
                data-testid="textarea-story-tags"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={setTagsMutation.isPending}
                  onClick={() => {
                    const slugs = tagDraft
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    setTagsMutation.mutate({
                      id: storyId,
                      data: { slugs, requesterAuthorName: authorName },
                    });
                  }}
                  data-testid="button-save-tags"
                >
                  {setTagsMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : null}
                  {t("story.saveTags")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {isAuthor && analytics && (
          <div className="container mx-auto px-4 max-w-4xl mt-4 relative z-20">
            <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur p-4">
              <h3 className="font-serif text-sm uppercase tracking-wider text-muted-foreground mb-3">
                {t("story.authorAnalytics")}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalViews}
                  </div>
                  <div className="text-xs text-muted-foreground">{t("story.views")}</div>
                </div>
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalCompleted}
                  </div>
                  <div className="text-xs text-muted-foreground">{t("story.finished")}</div>
                </div>
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalLikes}
                  </div>
                  <div className="text-xs text-muted-foreground">{t("story.likes")}</div>
                </div>
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalComments}
                  </div>
                  <div className="text-xs text-muted-foreground">{t("story.commentsLabel")}</div>
                </div>
              </div>
              {(analytics.daily ?? []).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground mb-2">
                    {t("story.last30Days")}
                  </p>
                  <div className="flex items-end gap-1 h-16">
                    {(analytics.daily ?? [])
                      .slice(0, 30)
                      .reverse()
                      .map((d) => {
                        const max = Math.max(
                          ...analytics.daily!.map((x) => x.views),
                          1,
                        );
                        const h = Math.max(2, (d.views / max) * 100);
                        return (
                          <div
                            key={d.day}
                            className="flex-1 bg-primary/40 rounded-t"
                            style={{ height: `${h}%` }}
                            title={t("story.dayViews", { day: d.day, count: d.views })}
                          />
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {regenerateStoryTextMutation.isPending && (
          <div className="container mx-auto px-4 max-w-3xl mt-8">
            <div className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/20 rounded-xl text-primary">
              <Loader2 className="w-5 h-5 animate-spin shrink-0" />
              <p className="font-serif">{t("story.conjuringNewProse")}</p>
            </div>
          </div>
        )}

        <div className="container mx-auto px-4 mt-16 max-w-3xl relative">
          <div className="absolute top-0 left-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent -translate-x-8 md:-translate-x-12" />
          <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent translate-x-8 md:translate-x-12" />

          {editMode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
                <Edit3 className="w-4 h-4" />
                <span>{t("story.editModeNotice")}</span>
              </div>
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="min-h-[600px] font-serif text-base leading-relaxed resize-y bg-card/50 border-primary/20 focus:border-primary/50"
                placeholder={t("story.storyTextPlaceholder")}
              />
              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleSaveEdit}
                  disabled={updateMutation.isPending}
                  className="font-serif"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  {t("story.saveChanges")}
                </Button>
                <Button variant="outline" onClick={handleCancelEdit} disabled={updateMutation.isPending}>
                  <X className="w-4 h-4 mr-2" />
                  {t("story.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="story-prose">{elements}</div>
          )}

          {!editMode && (
            <div className="mt-16">
              <BranchesSidebar
                storyId={storyId}
                authorName={authorName ?? ""}
                canEdit={isAuthor}
              />
            </div>
          )}

          {!editMode && (
            <div className="mt-24 pt-12 border-t border-border/50 text-center flex flex-col items-center">
              <div className="w-12 h-1 bg-primary/50 mb-12 rounded-full" />
              <h3 className="font-serif text-2xl mb-4">{t("story.theEnd")}</h3>
              <p className="text-muted-foreground mb-8">
                {t("story.conjuredUsing", { style: t(`artStyles.${story.artStyle}`, story.artStyle), genre: t(`genres.${story.genre}`, story.genre) })}
              </p>
              <div className="flex gap-3 flex-wrap justify-center">
                <Button
                  variant="outline"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                >
                  {t("story.backToTop")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    toast({ title: t("story.linkCopied"), description: t("story.linkCopiedDesc") });
                  }}
                  data-testid="button-share"
                >
                  <Share2 className="w-4 h-4 mr-2" /> {t("story.shareStory")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAudioOpen((v) => !v)}
                  data-testid="button-listen"
                >
                  <Volume2 className="w-4 h-4 mr-2" /> {audioOpen ? t("story.hideAudio") : t("story.listen")}
                </Button>
                <Button asChild variant="outline" data-testid="button-pdf">
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                    <FileDown className="w-4 h-4 mr-2" /> {t("story.downloadPdf")}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={handleGenerateTrailer}
                  disabled={
                    generateTrailerMutation.isPending ||
                    trailerQuery.data?.status === "rendering" ||
                    trailerQuery.data?.status === "queued"
                  }
                  data-testid="button-trailer"
                >
                  {trailerQuery.data?.status === "rendering" ||
                  trailerQuery.data?.status === "queued" ||
                  generateTrailerMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Film className="w-4 h-4 mr-2" />
                  )}
                  {trailerQuery.data?.status === "ready"
                    ? t("story.viewTrailer", "View trailer")
                    : trailerQuery.data?.status === "rendering" ||
                        trailerQuery.data?.status === "queued"
                      ? t("story.renderingTrailer", "Rendering trailer…")
                      : t("story.generateTrailer", "Generate trailer")}
                </Button>
              </div>
              {trailerOpen && (
                <div className="mt-8 w-full max-w-2xl" data-testid="trailer-panel">
                  {trailerQuery.data?.status === "ready" && trailerQuery.data.url ? (
                    <video
                      src={trailerQuery.data.url}
                      controls
                      playsInline
                      className="w-full rounded-lg shadow-lg"
                      data-testid="trailer-video"
                    />
                  ) : trailerQuery.data?.status === "failed" ? (
                    <p className="text-destructive text-sm">
                      {t("story.trailerFailedDesc", "Trailer render failed. Try again later.")}
                    </p>
                  ) : (
                    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {t(
                          "story.renderingTrailerHint",
                          "Rendering your trailer — this typically takes a minute.",
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="hidden">
                {isAuthor && illustrations.length >= 2 && (
                  <Button
                    variant="outline"
                    onClick={() => setReorderOpen(true)}
                    data-testid="button-reorder-illustrations"
                  >
                    <ArrowUpDown className="w-4 h-4 mr-2" /> {t("story.reorderArt")}
                  </Button>
                )}
                {isAuthor && (
                  <Button
                    variant="default"
                    onClick={() => continueStoryMutation.mutate({ id: storyId, data: { authorName, generateIllustration: true } })}
                    disabled={continueStoryMutation.isPending}
                    data-testid="button-continue"
                  >
                    {continueStoryMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <BookPlus className="w-4 h-4 mr-2" />
                    )}
                    {t("story.addNextChapter")}
                  </Button>
                )}
              </div>
              {audioOpen && (
                <div className="mt-6 w-full max-w-md">
                  <audio
                    controls
                    preload="none"
                    src={audioUrl}
                    className="w-full"
                    data-testid="audio-player"
                  >
                    {t("story.audioFallback")}
                  </audio>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    {t("story.audioGenNotice")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <div id="comments-section">
          <CommentsSection storyId={story.id} />
        </div>
      </article>
      {isAuthor && authorName && (
        <IllustrationReorderDialog
          storyId={storyId}
          illustrations={illustrations}
          authorName={authorName}
          open={reorderOpen}
          onOpenChange={setReorderOpen}
        />
      )}
    </Layout>
  );
}

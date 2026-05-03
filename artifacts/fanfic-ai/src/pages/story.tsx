import React, { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { FollowButton } from "@/components/follow-button";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { LikeButton } from "@/components/like-button";
import { RepostButton } from "@/components/repost-button";
import { IllustrationReorderDialog } from "@/components/illustration-reorder-dialog";
import { CommentsSection } from "@/components/comments-section";
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
  useAddCoAuthor,
  useRemoveCoAuthor,
  getGetStoryQueryKey,
  getGetIllustrationsQueryKey,
  getListCoAuthorsQueryKey,
  getGetStoryAudioUrl,
  getExportStoryPdfUrl,
  useRecordStoryView,
  useSetReadingProgress,
  useGetStoryAnalytics,
  useGetStoryTags,
  useSetStoryTags,
  getGetStoryAnalyticsQueryKey,
  getGetStoryTagsQueryKey,
} from "@workspace/api-client-react";
import { BookmarkButton } from "@/components/bookmark-button";
import { ReportButton } from "@/components/report-button";
import type { Illustration } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuthor } from "@/hooks/use-author";
import { format } from "date-fns";
import {
  BookOpen, Share2, Globe, Lock, RefreshCw, Trash2, Loader2,
  RotateCcw, Pencil, Edit3, Check, X, Volume2, FileDown, BookPlus, MessageCircle, ArrowUpDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function StoryReading() {
  const [, params] = useRoute("/story/:id");
  const storyId = Number(params?.id);
  const { authorName } = useAuthor();
  const { toast } = useToast();
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
        toast({ title: "New chapter added", description: "Scroll down to read the continuation." });
      },
      onError: () => toast({ title: "Failed to continue story", variant: "destructive" }),
    },
  });

  const [audioOpen, setAudioOpen] = useState(false);
  const audioUrl = getGetStoryAudioUrl(storyId);
  const pdfUrl = getExportStoryPdfUrl(storyId);

  const { data: coAuthorData } = useListCoAuthors(storyId, {
    query: { enabled: !!storyId, queryKey: getListCoAuthorsQueryKey(storyId) },
  });
  const coAuthors = coAuthorData?.coAuthors ?? story?.coAuthors ?? [];
  const isPrimaryAuthor = !!authorName && story?.authorName === authorName;
  const isCoAuthor = !!authorName && coAuthors.includes(authorName);
  const isAuthor = isPrimaryAuthor || isCoAuthor;
  const [coAuthorDraft, setCoAuthorDraft] = useState("");
  const addCoAuthorMutation = useAddCoAuthor({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCoAuthorsQueryKey(storyId) });
        setCoAuthorDraft("");
        toast({ title: "Co-author added" });
      },
      onError: () => toast({ title: "Could not add co-author", variant: "destructive" }),
    },
  });
  const removeCoAuthorMutation = useRemoveCoAuthor({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCoAuthorsQueryKey(storyId) });
        toast({ title: "Co-author removed" });
      },
      onError: () => toast({ title: "Could not remove co-author", variant: "destructive" }),
    },
  });

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

  // Throttle reading-progress writes while the user scrolls.
  const setProgress = useSetReadingProgress();
  useEffect(() => {
    if (!storyId || !authorName?.trim()) return;
    let lastSent = 0;
    let completedSent = false;
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const pct = Math.max(0, Math.min(100, Math.round((scrollTop / max) * 100)));
      const now = Date.now();
      if (Math.abs(pct - lastSent) >= 10 || (pct >= 95 && !completedSent)) {
        lastSent = pct;
        setProgress.mutate({
          id: storyId,
          data: { authorName, progress: pct },
        });
        if (pct >= 95 && !completedSent) {
          completedSent = true;
          recordView.mutate({
            id: storyId,
            data: { viewerName: authorName, completed: true },
          });
        }
      }
      void now;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
        toast({ title: "Tags saved" });
      },
      onError: () => toast({ title: "Failed to save tags", variant: "destructive" }),
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
          toast({ title: "Story Saved", description: "Your edits have been preserved." });
        },
        onError: () => {
          toast({ title: "Save Failed", description: "Could not save your changes.", variant: "destructive" });
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
            title: newStatus === "published" ? "Story Published" : "Story Unpublished",
            description:
              newStatus === "published"
                ? "Your story is now visible to the public."
                : "Your story is back to draft status.",
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
          toast({ title: "Story Rewritten", description: "Fresh prose has been conjured." });
        },
        onError: () => {
          toast({ title: "Regeneration Failed", description: "Could not regenerate story text.", variant: "destructive" });
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
          toast({ title: "Illustration Regenerated", description: "A new scene has been painted." });
        },
        onError: () => {
          toast({ title: "Regeneration Failed", description: "Could not regenerate illustration.", variant: "destructive" });
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
          toast({ title: "Illustration Removed" });
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
          toast({ title: "Illustration Added" });
        },
        onError: () => {
          toast({ title: "Failed", description: "Could not generate illustration.", variant: "destructive" });
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
          toast({ title: "Section Rewritten" });
        },
        onError: () => {
          toast({ title: "Failed", description: "Could not regenerate this section.", variant: "destructive" });
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
          <h1 className="text-2xl font-serif mb-2">Story Not Found</h1>
          <p className="text-muted-foreground">This tale may have been lost to the void.</p>
        </div>
      </Layout>
    );
  }

  const paragraphs = (story.fullText || "").split(/\n\n+/).filter((p) => p.trim());
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

  const elements: React.ReactNode[] = [];
  paragraphs.forEach((p, i) => {
    const thisSectionIdx = paragraphSectionIndex(i);
    const isRegenSection = regeneratingSectionIdx === thisSectionIdx;

    elements.push(
      <div
        key={`p-wrap-${i}`}
        className={`relative group/para ${isRegenSection ? "opacity-40 pointer-events-none" : ""}`}
      >
        {isAuthor && !editMode && (
          <div className="absolute -left-10 top-1 opacity-0 group-hover/para:opacity-100 transition-opacity">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              title="Rewrite this section with AI"
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
        <p className="mb-6 leading-relaxed">{p}</p>
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
                  <span className="ml-2 text-muted-foreground">Painting new scene…</span>
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
                  Regenerate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  disabled={isRegeneratingIll(ill)}
                  onClick={() => openPromptEditor(ill)}
                >
                  <Edit3 className="w-3 h-3 mr-1" />
                  Edit prompt
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs h-7"
                  disabled={deleteIllustrationMutation.isPending}
                  onClick={() => handleDeleteIllustration(ill)}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Remove
                </Button>
              </div>
            )}
            {isAuthor && promptEditingId === ill.id && (
              <div className="mt-3 p-3 rounded-lg border bg-muted/30 space-y-2">
                <div className="text-xs text-muted-foreground font-medium">
                  Edit illustration prompt
                </div>
                <Textarea
                  value={promptDraft}
                  onChange={(e) => setPromptDraft(e.target.value)}
                  rows={4}
                  className="text-sm font-mono"
                  placeholder="Describe the scene you want to paint..."
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
                    Cancel
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
                    Regenerate with this prompt
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
              Add Illustration Here
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
        description={story.summary ?? `A ${story.genre} story by ${story.authorName}`}
        image={story.coverImageUrl ?? undefined}
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
              {story.genre} • {story.artStyle}
            </Badge>
            <h1 className="font-serif text-5xl md:text-7xl font-bold tracking-tight mb-6 glow-text text-white drop-shadow-lg">
              {story.title}
            </h1>
            <p className="text-xl text-white/80 italic font-serif">
              By{" "}
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
              {format(new Date(story.createdAt), "MMMM do, yyyy")}
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
            <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="font-serif text-sm uppercase tracking-wider text-muted-foreground">
                  Co-authors
                </h3>
                <span className="text-xs text-muted-foreground">
                  Co-authors can add new chapters.
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                {coAuthors.length === 0 && (
                  <span className="text-sm text-muted-foreground italic">No co-authors yet.</span>
                )}
                {coAuthors.map((name) => (
                  <Badge key={name} variant="secondary" className="gap-2">
                    {name}
                    <button
                      type="button"
                      className="hover:text-destructive"
                      disabled={removeCoAuthorMutation.isPending}
                      onClick={() =>
                        removeCoAuthorMutation.mutate({
                          id: story.id,
                          data: {
                            requesterAuthorName: authorName,
                            coAuthorName: name,
                          },
                        })
                      }
                      aria-label={`Remove ${name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = coAuthorDraft.trim();
                  if (!name) return;
                  addCoAuthorMutation.mutate({
                    id: story.id,
                    data: { requesterAuthorName: authorName, coAuthorName: name },
                  });
                }}
              >
                <input
                  type="text"
                  value={coAuthorDraft}
                  onChange={(e) => setCoAuthorDraft(e.target.value)}
                  placeholder="Add co-author by pen name"
                  className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={addCoAuthorMutation.isPending || !coAuthorDraft.trim()}
                >
                  {addCoAuthorMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </Button>
              </form>
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
                  Save Changes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full shadow-lg backdrop-blur-md"
                  onClick={handleCancelEdit}
                  disabled={updateMutation.isPending}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
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
                  Edit Text
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
                  Rewrite Story
                </Button>
                <Button
                  variant={story.status === "published" ? "outline" : "default"}
                  size="sm"
                  className="rounded-full shadow-lg backdrop-blur-md"
                  onClick={togglePublish}
                  disabled={updateMutation.isPending}
                >
                  {story.status === "published" ? (
                    <><Lock className="w-4 h-4 mr-2" /> Make Draft</>
                  ) : (
                    <><Globe className="w-4 h-4 mr-2" /> Publish to Feed</>
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
                Tags
              </h3>
              <Textarea
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                rows={2}
                placeholder="Comma-separated tags (max 8): e.g. magic, slow-burn, found-family"
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
                  Save tags
                </Button>
              </div>
            </div>
          </div>
        )}

        {isAuthor && analytics && (
          <div className="container mx-auto px-4 max-w-4xl mt-4 relative z-20">
            <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur p-4">
              <h3 className="font-serif text-sm uppercase tracking-wider text-muted-foreground mb-3">
                Author analytics
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalViews}
                  </div>
                  <div className="text-xs text-muted-foreground">Views</div>
                </div>
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalCompleted}
                  </div>
                  <div className="text-xs text-muted-foreground">Finished</div>
                </div>
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalLikes}
                  </div>
                  <div className="text-xs text-muted-foreground">Likes</div>
                </div>
                <div>
                  <div className="font-serif text-2xl font-bold tabular-nums">
                    {analytics.totalComments}
                  </div>
                  <div className="text-xs text-muted-foreground">Comments</div>
                </div>
              </div>
              {(analytics.daily ?? []).length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground mb-2">
                    Last 30 days
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
                            title={`${d.day}: ${d.views} views`}
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
              <p className="font-serif">Conjuring new prose… this may take a moment.</p>
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
                <span>Edit mode — change the text directly. Illustrations are preserved.</span>
              </div>
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="min-h-[600px] font-serif text-base leading-relaxed resize-y bg-card/50 border-primary/20 focus:border-primary/50"
                placeholder="Your story text…"
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
                  Save Changes
                </Button>
                <Button variant="outline" onClick={handleCancelEdit} disabled={updateMutation.isPending}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="story-prose">{elements}</div>
          )}

          {!editMode && (
            <div className="mt-24 pt-12 border-t border-border/50 text-center flex flex-col items-center">
              <div className="w-12 h-1 bg-primary/50 mb-12 rounded-full" />
              <h3 className="font-serif text-2xl mb-4">The End</h3>
              <p className="text-muted-foreground mb-8">
                Conjured using {story.artStyle} illustrations in the {story.genre} genre.
              </p>
              <div className="flex gap-3 flex-wrap justify-center">
                <Button
                  variant="outline"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                >
                  Back to Top
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    toast({ title: "Link Copied", description: "Share your tale with the world." });
                  }}
                  data-testid="button-share"
                >
                  <Share2 className="w-4 h-4 mr-2" /> Share Story
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAudioOpen((v) => !v)}
                  data-testid="button-listen"
                >
                  <Volume2 className="w-4 h-4 mr-2" /> {audioOpen ? "Hide Audio" : "Listen"}
                </Button>
                <Button asChild variant="outline" data-testid="button-pdf">
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                    <FileDown className="w-4 h-4 mr-2" /> Download PDF
                  </a>
                </Button>
                {isAuthor && illustrations.length >= 2 && (
                  <Button
                    variant="outline"
                    onClick={() => setReorderOpen(true)}
                    data-testid="button-reorder-illustrations"
                  >
                    <ArrowUpDown className="w-4 h-4 mr-2" /> Reorder Art
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
                    Add Next Chapter
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
                    Your browser does not support the audio element.
                  </audio>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    First play takes ~10 seconds while the narration is generated.
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

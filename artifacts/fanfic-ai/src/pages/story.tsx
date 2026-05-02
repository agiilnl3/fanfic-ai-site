import React, { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { LikeButton } from "@/components/like-button";
import {
  useGetStory,
  useUpdateStory,
  useDeleteIllustration,
  useGenerateIllustration,
  useRegenerateIllustration,
  useRegenerateStoryText,
  useRegenerateStorySection,
  useContinueStory,
  getGetStoryQueryKey,
  getGetIllustrationsQueryKey,
  getGetStoryAudioUrl,
  getExportStoryPdfUrl,
} from "@workspace/api-client-react";
import type { Illustration } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useAuthor } from "@/hooks/use-author";
import { format } from "date-fns";
import {
  BookOpen, Share2, Globe, Lock, RefreshCw, Trash2, Loader2,
  RotateCcw, Pencil, Edit3, Check, X, Volume2, FileDown, BookPlus,
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

  const isAuthor = story?.authorName === authorName;

  useEffect(() => {
    if (editMode && story?.fullText) {
      setEditText(story.fullText);
    }
  }, [editMode, story?.fullText]);

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

  const handleRegenerateIllustration = (ill: Illustration) => {
    if (!story) return;
    regenerateIllustrationMutation.mutate(
      { id: story.id, illustrationId: ill.id },
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
          toast({ title: "Illustration Regenerated", description: "A new scene has been painted." });
        },
        onError: () => {
          toast({ title: "Regeneration Failed", description: "Could not regenerate illustration.", variant: "destructive" });
        },
      },
    );
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

  const insertAfterParagraph = new Map<number, number>();
  for (const ill of illustrations) {
    const s = ill.sectionIndex;
    const paraIdx = Math.min(
      Math.floor(((s + 1) * paragraphs.length) / numSections) - 1,
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
            {isAuthor && !editMode && (
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
            <p className="text-xl text-white/80 italic font-serif">By {story.authorName}</p>
            <p className="text-sm text-white/50 mt-4 uppercase tracking-widest">
              {format(new Date(story.createdAt), "MMMM do, yyyy")}
            </p>
            <div className="mt-6 flex justify-center">
              <LikeButton storyId={story.id} size="lg" variant="outline" className="bg-background/30 backdrop-blur-md border-white/20 text-white hover:bg-background/50 hover:text-rose-400 px-4" />
            </div>
          </div>
        </header>

        {isAuthor && (
          <div className="container mx-auto px-4 max-w-4xl -mt-4 relative z-20 flex justify-end gap-2 flex-wrap">
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
      </article>
    </Layout>
  );
}

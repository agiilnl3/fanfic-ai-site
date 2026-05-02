import React, { useState } from "react";
import { useRoute } from "wouter";
import { Layout } from "@/components/layout";
import {
  useGetStory,
  useUpdateStory,
  useDeleteIllustration,
  useGenerateIllustration,
  getGetStoryQueryKey,
  getGetIllustrationsQueryKey,
} from "@workspace/api-client-react";
import type { Illustration } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthor } from "@/hooks/use-author";
import { format } from "date-fns";
import { BookOpen, Share2, Globe, Lock, RefreshCw, Trash2, Loader2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export default function StoryReading() {
  const [, params] = useRoute("/story/:id");
  const storyId = Number(params?.id);
  const { authorName } = useAuthor();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [regeneratingStory, setRegeneratingStory] = useState(false);
  const [regeneratingIllId, setRegeneratingIllId] = useState<number | null>(null);

  const { data: story, isLoading, error } = useGetStory(storyId, {
    query: {
      enabled: !!storyId,
      queryKey: getGetStoryQueryKey(storyId),
    },
  });

  const updateMutation = useUpdateStory();
  const deleteIllustrationMutation = useDeleteIllustration();
  const generateIllustrationMutation = useGenerateIllustration();

  const isAuthor = story?.authorName === authorName;

  const togglePublish = () => {
    if (!story) return;
    const newStatus = story.status === "published" ? "draft" : "published";

    updateMutation.mutate(
      { id: story.id, data: { status: newStatus } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), {
            ...story,
            ...updated,
          });
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

  const handleRegenerateStoryText = async () => {
    if (!story) return;
    setRegeneratingStory(true);
    try {
      const updated = await apiFetch<typeof story>(`/api/stories/${story.id}/regenerate`, {
        method: "POST",
      });
      queryClient.setQueryData(getGetStoryQueryKey(story.id), {
        ...story,
        ...updated,
      });
      toast({ title: "Story Rewritten", description: "Fresh prose has been conjured." });
    } catch {
      toast({ title: "Regeneration Failed", description: "Could not regenerate story text.", variant: "destructive" });
    } finally {
      setRegeneratingStory(false);
    }
  };

  const handleRegenerateIllustration = async (ill: Illustration) => {
    if (!story) return;
    setRegeneratingIllId(ill.id);
    try {
      const updated = await apiFetch<Illustration>(
        `/api/stories/${story.id}/illustrations/${ill.id}/regenerate`,
        { method: "POST" },
      );
      queryClient.setQueryData(getGetStoryQueryKey(story.id), (old: typeof story | undefined) => {
        if (!old) return old;
        return {
          ...old,
          illustrations: old.illustrations.map((i) =>
            i.id === ill.id ? updated : i,
          ),
          coverImageUrl: ill.sectionIndex === 0 ? updated.imageUrl : old.coverImageUrl,
        };
      });
      toast({ title: "Illustration Regenerated", description: "A new scene has been painted." });
    } catch {
      toast({ title: "Regeneration Failed", description: "Could not regenerate illustration.", variant: "destructive" });
    } finally {
      setRegeneratingIllId(null);
    }
  };

  const handleDeleteIllustration = (ill: Illustration) => {
    if (!story) return;
    deleteIllustrationMutation.mutate(
      { id: story.id, illustrationId: ill.id },
      {
        onSuccess: () => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), (old: typeof story | undefined) => {
            if (!old) return old;
            return {
              ...old,
              illustrations: old.illustrations.filter((i) => i.id !== ill.id),
            };
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
          toast({ title: "Illustration Added", description: "A new scene was painted for this section." });
        },
        onError: () => {
          toast({ title: "Failed", description: "Could not generate illustration.", variant: "destructive" });
        },
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

  const paragraphs = (story.fullText || "").split(/\n\n+/);
  const illustrations = [...(story.illustrations || [])].sort(
    (a, b) => a.sectionIndex - b.sectionIndex,
  );
  let illIndex = 0;

  const elements: React.ReactNode[] = [];
  paragraphs.forEach((p, i) => {
    if (p.trim()) {
      elements.push(
        <p key={`p-${i}`} className="mb-6 leading-relaxed">
          {p}
        </p>,
      );
    }

    if (i > 0 && i % 3 === 0) {
      const ill = illIndex < illustrations.length ? illustrations[illIndex] : null;

      if (ill) {
        elements.push(
          <figure key={`ill-${ill.id}`} className="my-12 relative group">
            <div className="rounded-xl overflow-hidden book-shadow relative">
              {regeneratingIllId === ill.id ? (
                <div className="w-full h-64 flex items-center justify-center bg-muted/30">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Painting new scene...</span>
                </div>
              ) : (
                <img src={ill.imageUrl} alt={ill.prompt} className="w-full h-auto object-cover" />
              )}
              <div className="absolute inset-0 ring-1 ring-inset ring-white/10 pointer-events-none rounded-xl" />
            </div>

            {isAuthor && (
              <div className="mt-2 flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs h-7"
                  disabled={regeneratingIllId === ill.id}
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
        illIndex++;
      } else if (isAuthor) {
        const sectionText = paragraphs.slice(Math.max(0, i - 2), i + 1).join("\n\n");
        elements.push(
          <div key={`add-ill-${i}`} className="my-8 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              className="border-dashed text-xs opacity-50 hover:opacity-100 transition-opacity"
              disabled={generateIllustrationMutation.isPending}
              onClick={() => handleAddIllustration(illIndex, sectionText)}
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
          </div>
        </header>

        {isAuthor && (
          <div className="container mx-auto px-4 max-w-4xl -mt-4 relative z-20 flex justify-end gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full shadow-lg backdrop-blur-md"
              onClick={handleRegenerateStoryText}
              disabled={regeneratingStory}
            >
              {regeneratingStory ? (
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
                <>
                  <Lock className="w-4 h-4 mr-2" /> Make Draft
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4 mr-2" /> Publish to Feed
                </>
              )}
            </Button>
          </div>
        )}

        {regeneratingStory && (
          <div className="container mx-auto px-4 max-w-3xl mt-8">
            <div className="flex items-center gap-3 p-4 bg-primary/10 border border-primary/20 rounded-xl text-primary">
              <Loader2 className="w-5 h-5 animate-spin shrink-0" />
              <p className="font-serif">Conjuring new prose... this may take a moment.</p>
            </div>
          </div>
        )}

        <div className="container mx-auto px-4 mt-16 max-w-3xl relative">
          <div className="absolute top-0 left-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent -translate-x-8 md:-translate-x-12" />
          <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent translate-x-8 md:translate-x-12" />

          <div className="story-prose">{elements}</div>

          <div className="mt-24 pt-12 border-t border-border/50 text-center flex flex-col items-center">
            <div className="w-12 h-1 bg-primary/50 mb-12 rounded-full" />
            <h3 className="font-serif text-2xl mb-4">The End</h3>
            <p className="text-muted-foreground mb-8">
              Conjured using {story.artStyle} illustrations in the {story.genre} genre.
            </p>
            <div className="flex gap-4">
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
              >
                <Share2 className="w-4 h-4 mr-2" /> Share Story
              </Button>
            </div>
          </div>
        </div>
      </article>
    </Layout>
  );
}

import { useRoute } from "wouter";
import { Layout } from "@/components/layout";
import { useGetStory, useUpdateStory } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthor } from "@/hooks/use-author";
import { format } from "date-fns";
import { BookOpen, Share2, Globe, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetStoryQueryKey } from "@workspace/api-client-react";

export default function StoryReading() {
  const [, params] = useRoute("/story/:id");
  const storyId = Number(params?.id);
  const { authorName } = useAuthor();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: story, isLoading, error } = useGetStory(storyId, {
    query: {
      enabled: !!storyId,
      queryKey: getGetStoryQueryKey(storyId)
    }
  });

  const updateMutation = useUpdateStory();

  const isAuthor = story?.authorName === authorName;

  const togglePublish = () => {
    if (!story) return;
    const newStatus = story.status === "published" ? "draft" : "published";
    
    updateMutation.mutate(
      {
        id: story.id,
        data: { status: newStatus }
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetStoryQueryKey(story.id), {
            ...story,
            ...updated
          });
          toast({
            title: newStatus === "published" ? "Story Published" : "Story Unpublished",
            description: newStatus === "published" ? "Your story is now visible to the public." : "Your story is back to draft status.",
          });
        }
      }
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

  // Interleave illustrations into the text
  const paragraphs = (story.fullText || "").split(/\n\n+/);
  const elements: React.ReactNode[] = [];
  
  // Sort illustrations by section index
  const illustrations = [...(story.illustrations || [])].sort((a, b) => a.sectionIndex - b.sectionIndex);
  let illIndex = 0;

  paragraphs.forEach((p, i) => {
    if (p.trim()) {
      elements.push(<p key={`p-${i}`}>{p}</p>);
    }
    
    // Insert illustration after every ~3 paragraphs if we have them
    if (i > 0 && i % 3 === 0 && illIndex < illustrations.length) {
      const ill = illustrations[illIndex];
      elements.push(
        <figure key={`ill-${ill.id}`} className="my-12">
          <div className="rounded-xl overflow-hidden book-shadow relative group">
            <img 
              src={ill.imageUrl} 
              alt={ill.prompt} 
              className="w-full h-auto object-cover"
            />
            <div className="absolute inset-0 ring-1 ring-inset ring-white/10 pointer-events-none rounded-xl" />
          </div>
          {ill.caption && (
            <figcaption className="text-center text-muted-foreground text-sm italic mt-4 px-8">
              {ill.caption}
            </figcaption>
          )}
        </figure>
      );
      illIndex++;
    }
  });

  return (
    <Layout>
      <article className="pb-32 animate-in fade-in duration-700">
        {/* Cover Header */}
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
              By {story.authorName}
            </p>
            <p className="text-sm text-white/50 mt-4 uppercase tracking-widest">
              {format(new Date(story.createdAt), "MMMM do, yyyy")}
            </p>
          </div>
        </header>

        {/* Action Bar (Author only) */}
        {isAuthor && (
          <div className="container mx-auto px-4 max-w-4xl -mt-4 relative z-20 flex justify-end">
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
          </div>
        )}

        {/* Prose Content */}
        <div className="container mx-auto px-4 mt-16 max-w-3xl relative">
          
          {/* Subtle page decorations */}
          <div className="absolute top-0 left-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent -translate-x-8 md:-translate-x-12" />
          <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-transparent via-border/50 to-transparent translate-x-8 md:translate-x-12" />
          
          <div className="story-prose">
            {elements}
          </div>

          <div className="mt-24 pt-12 border-t border-border/50 text-center flex flex-col items-center">
            <div className="w-12 h-1 bg-primary/50 mb-12 rounded-full" />
            <h3 className="font-serif text-2xl mb-4">The End</h3>
            <p className="text-muted-foreground mb-8">
              Conjured using {story.artStyle} illustrations in the {story.genre} genre.
            </p>
            
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                Back to Top
              </Button>
              <Button variant="secondary" onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast({ title: "Link Copied", description: "Share your tale with the world." });
              }}>
                <Share2 className="w-4 h-4 mr-2" /> Share Story
              </Button>
            </div>
          </div>
        </div>
      </article>
    </Layout>
  );
}

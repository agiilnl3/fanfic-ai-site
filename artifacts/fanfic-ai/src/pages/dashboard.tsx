import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { useAuthor } from "@/hooks/use-author";
import { useListStories, useUpdateStory, useDeleteStory, getListStoriesQueryKey } from "@workspace/api-client-react";
import { StoryCard } from "@/components/story-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PenTool, Trash2, Globe, Lock, Edit2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Story } from "@workspace/api-client-react";

export default function Dashboard() {
  const { authorName, setAuthorName } = useAuthor();
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(authorName);
  
  const { data: stories, isLoading } = useListStories({ authorName }, {
    query: { enabled: !!authorName }
  });

  const drafts = stories?.filter(s => s.status === "draft") || [];
  const published = stories?.filter(s => s.status === "published") || [];

  const handleSaveName = () => {
    if (tempName.trim()) {
      setAuthorName(tempName.trim());
      setEditingName(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-6">
          <div>
            <h1 className="font-serif text-4xl font-bold mb-4">Author's Desk</h1>
            
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input 
                  value={tempName} 
                  onChange={e => setTempName(e.target.value)} 
                  className="max-w-[200px]"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && handleSaveName()}
                />
                <Button size="icon" variant="ghost" onClick={handleSaveName}><Check className="w-4 h-4 text-green-500"/></Button>
                <Button size="icon" variant="ghost" onClick={() => { setTempName(authorName); setEditingName(false); }}><X className="w-4 h-4 text-red-500"/></Button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-xl text-muted-foreground group">
                Writing as <span className="font-serif text-foreground font-semibold text-2xl">{authorName || "Anonymous"}</span>
                <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8" onClick={() => { setTempName(authorName); setEditingName(true); }}>
                  <Edit2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          <Link href="/create">
            <Button size="lg" className="font-serif">
              <PenTool className="w-4 h-4 mr-2" /> Conjure New Story
            </Button>
          </Link>
        </div>

        {!authorName ? (
          <Card className="bg-card/50 backdrop-blur-sm border-primary/20 text-center py-16">
            <CardContent>
              <PenTool className="w-12 h-12 mx-auto text-primary/50 mb-4" />
              <h2 className="text-2xl font-serif mb-2">Claim Your Pen Name</h2>
              <p className="text-muted-foreground mb-6">Enter a name to start tracking your literary creations.</p>
              <div className="flex max-w-sm mx-auto gap-2">
                <Input 
                  value={tempName} 
                  onChange={e => setTempName(e.target.value)} 
                  placeholder="Your Name"
                />
                <Button onClick={handleSaveName}>Save</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="drafts" className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2 mb-8 h-12 bg-background/50 border border-border">
              <TabsTrigger value="drafts" className="text-base data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                Drafts ({drafts.length})
              </TabsTrigger>
              <TabsTrigger value="published" className="text-base data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
                Published ({published.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="drafts" className="mt-0">
              <StoryGrid stories={drafts} isLoading={isLoading} emptyMessage="No drafts found. Your desk is clear." authorName={authorName} />
            </TabsContent>
            
            <TabsContent value="published" className="mt-0">
              <StoryGrid stories={published} isLoading={isLoading} emptyMessage="You haven't published any tales yet." authorName={authorName} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Layout>
  );
}

function StoryGrid({ stories, isLoading, emptyMessage, authorName }: { stories: Story[], isLoading: boolean, emptyMessage: string, authorName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateStory();
  const deleteMutation = useDeleteStory();

  const handleTogglePublish = (story: Story) => {
    const newStatus = story.status === "published" ? "draft" : "published";
    updateMutation.mutate(
      { id: story.id, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListStoriesQueryKey({ authorName }) });
          toast({ title: newStatus === "published" ? "Published!" : "Moved to Drafts" });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this story? It cannot be undone.")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListStoriesQueryKey({ authorName }) });
            toast({ title: "Story deleted" });
          }
        }
      );
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-[300px] w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className="text-center py-20 border border-dashed border-border/50 rounded-2xl bg-card/10">
        <p className="text-muted-foreground text-lg">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {stories.map(story => (
        <div key={story.id} className="relative group">
          <StoryCard story={story} />
          
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <Button 
              size="icon" 
              variant="secondary" 
              className="h-8 w-8 bg-background/80 hover:bg-background backdrop-blur"
              onClick={(e) => { e.preventDefault(); handleTogglePublish(story); }}
              title={story.status === "published" ? "Make Draft" : "Publish"}
            >
              {story.status === "published" ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
            </Button>
            <Button 
              size="icon" 
              variant="destructive" 
              className="h-8 w-8 bg-destructive/80 hover:bg-destructive backdrop-blur"
              onClick={(e) => { e.preventDefault(); handleDelete(story.id); }}
              title="Delete Story"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

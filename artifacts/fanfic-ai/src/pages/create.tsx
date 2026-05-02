import { useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useAuthor } from "@/hooks/use-author";
import { useGenerateStory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, BookOpen, PenTool, Image as ImageIcon } from "lucide-react";

const GENRES = ["Fantasy", "Romance", "Science Fiction", "Mystery", "Horror", "Adventure", "Historical", "Contemporary"];
const ART_STYLES = ["Watercolor", "Oil Painting", "Digital Art", "Ink Sketch", "Comic Book", "Concept Art", "Impressionist", "Anime"];

export default function CreateStory() {
  const [, setLocation] = useLocation();
  const { authorName, setAuthorName } = useAuthor();
  const { toast } = useToast();
  
  const [genre, setGenre] = useState<string>("Fantasy");
  const [artStyle, setArtStyle] = useState<string>("Watercolor");
  const [lengthSetting, setLengthSetting] = useState<"short" | "medium" | "long">("medium");
  const [seedPrompt, setSeedPrompt] = useState<string>("");
  const [generateIllustrations, setGenerateIllustrations] = useState<boolean>(true);

  const generateMutation = useGenerateStory();

  const handleGenerate = () => {
    if (!authorName.trim()) {
      toast({
        title: "Pen Name Required",
        description: "Please enter a pen name to sign your work.",
        variant: "destructive",
      });
      return;
    }

    generateMutation.mutate(
      {
        data: {
          genre,
          artStyle,
          lengthSetting,
          authorName: authorName.trim(),
          seedPrompt: seedPrompt.trim() || undefined,
          generateIllustrations,
        },
      },
      {
        onSuccess: (story) => {
          setLocation(`/story/${story.id}`);
        },
        onError: (err) => {
          toast({
            title: "Failed to conjure story",
            description: err instanceof Error ? err.message : "An unknown error occurred.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        {generateMutation.isPending ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-1000">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
              <Sparkles className="w-12 h-12 text-primary animate-pulse" />
            </div>
            
            <div className="text-center space-y-4 max-w-md">
              <h2 className="font-serif text-3xl font-bold glow-text">Conjuring Your Tale</h2>
              <div className="space-y-2 text-muted-foreground">
                <p className="animate-pulse">Weaving words...</p>
                {generateIllustrations && <p className="animate-pulse delay-150">Painting scenes...</p>}
                <p className="animate-pulse delay-300 text-sm italic mt-4">This usually takes 30-60 seconds. Please don't close this page.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="text-center mb-10">
              <h1 className="font-serif text-4xl font-bold mb-4">A Blank Page Awaits</h1>
              <p className="text-muted-foreground text-lg">Define the essence of your story, and let the AI weave the details.</p>
            </div>

            <Card className="bg-card/50 backdrop-blur-sm border-primary/10 shadow-[0_0_40px_hsl(var(--primary)/0.05)]">
              <CardHeader>
                <CardTitle className="font-serif flex items-center text-2xl">
                  <PenTool className="w-5 h-5 mr-2 text-primary" />
                  Story Parameters
                </CardTitle>
                <CardDescription>
                  Configure the themes, style, and tone.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="authorName">Your Pen Name</Label>
                    <Input 
                      id="authorName" 
                      value={authorName} 
                      onChange={(e) => setAuthorName(e.target.value)} 
                      placeholder="Jane Austen"
                      className="bg-background/50"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Length</Label>
                    <Select value={lengthSetting} onValueChange={(val) => setLengthSetting(val as "short" | "medium" | "long")}>
                      <SelectTrigger className="bg-background/50">
                        <SelectValue placeholder="Select length" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="short">Short Tale (~500 words)</SelectItem>
                        <SelectItem value="medium">Novelette (~1000 words)</SelectItem>
                        <SelectItem value="long">Novella (~2000 words)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Genre</Label>
                    <Select value={genre} onValueChange={setGenre}>
                      <SelectTrigger className="bg-background/50">
                        <SelectValue placeholder="Select genre" />
                      </SelectTrigger>
                      <SelectContent>
                        {GENRES.map(g => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Illustration Style</Label>
                    <Select value={artStyle} onValueChange={setArtStyle}>
                      <SelectTrigger className="bg-background/50">
                        <SelectValue placeholder="Select art style" />
                      </SelectTrigger>
                      <SelectContent>
                        {ART_STYLES.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2 pt-4">
                  <Label htmlFor="seedPrompt">Seed Prompt (Optional)</Label>
                  <Textarea 
                    id="seedPrompt" 
                    value={seedPrompt} 
                    onChange={(e) => setSeedPrompt(e.target.value)} 
                    placeholder="A cursed mirror in a dusty antique shop that shows the viewer's deepest regret..."
                    className="h-32 bg-background/50 resize-none"
                  />
                  <p className="text-xs text-muted-foreground">Give the AI a starting point, a character, or a premise. Leave blank for a completely random story.</p>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                  <div className="space-y-0.5">
                    <Label className="flex items-center text-base">
                      <ImageIcon className="w-4 h-4 mr-2" />
                      Generate Illustrations
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Create matching artwork throughout the story.
                    </p>
                  </div>
                  <Switch 
                    checked={generateIllustrations} 
                    onCheckedChange={setGenerateIllustrations} 
                  />
                </div>

                <Button 
                  className="w-full h-14 text-lg font-serif mt-6" 
                  onClick={handleGenerate}
                  disabled={generateMutation.isPending}
                >
                  <Sparkles className="mr-2 w-5 h-5" />
                  Conjure Story
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}

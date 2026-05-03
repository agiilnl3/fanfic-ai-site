import { useState } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { useAuthor } from "@/hooks/use-author";
import {
  useListSeries,
  useCreateSeries,
  getListSeriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Loader2, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SeriesPage() {
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");

  const params = authorName?.trim() ? { authorName } : {};
  const queryKey = getListSeriesQueryKey(params);
  const { data: series, isLoading } = useListSeries(params, {
    query: { queryKey, enabled: !!authorName?.trim() },
  });

  const createMutation = useCreateSeries({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey });
        setTitle("");
        setSummary("");
        toast({ title: "Series created" });
      },
      onError: () =>
        toast({ title: "Failed to create series", variant: "destructive" }),
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorName?.trim() || !title.trim()) return;
    createMutation.mutate({
      data: {
        title: title.trim(),
        summary: summary.trim() || null,
        authorName,
      },
    });
  };

  return (
    <Layout>
      <Seo title="My Series" description="Group your stories into ongoing series." />
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="font-serif text-3xl md:text-4xl font-bold mb-2">My Series</h1>
          <p className="text-muted-foreground">
            Bundle related stories so readers can binge them in order.
          </p>
        </div>

        {!authorName?.trim() ? (
          <div className="text-center py-24 border border-dashed border-border/50 rounded-2xl bg-card/10">
            <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">
              Set a pen name on the New Story page to manage series.
            </p>
          </div>
        ) : (
          <>
            <form
              onSubmit={handleCreate}
              className="mb-8 space-y-3 p-4 rounded-xl bg-card/40 border border-border/50"
              data-testid="form-create-series"
            >
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Series title (e.g. The Twilight Chronicles)"
                data-testid="input-series-title"
              />
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Optional one-line synopsis"
                rows={2}
                data-testid="textarea-series-summary"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!title.trim() || createMutation.isPending}
                data-testid="button-create-series"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Create series
              </Button>
            </form>

            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : (series ?? []).length === 0 ? (
              <p className="text-muted-foreground italic">No series yet.</p>
            ) : (
              <ul className="space-y-3">
                {(series ?? []).map((s) => (
                  <li key={s.id}>
                    <Link href={`/series/${s.id}`}>
                      <Card className="cursor-pointer hover:bg-accent/30 transition-colors">
                        <CardHeader className="pb-2">
                          <CardTitle className="font-serif text-lg">
                            {s.title}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                          {s.summary && (
                            <p className="line-clamp-2 mb-1">{s.summary}</p>
                          )}
                          <p className="text-xs">
                            {s.storyCount} {s.storyCount === 1 ? "story" : "stories"}
                          </p>
                        </CardContent>
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

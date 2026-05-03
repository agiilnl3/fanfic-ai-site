import { useState } from "react";
import { Link, useRoute } from "wouter";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { useAuthor } from "@/hooks/use-author";
import {
  useGetSeries,
  useUpdateSeries,
  useDeleteSeries,
  useAddStoryToSeries,
  useRemoveStoryFromSeries,
  useListStories,
  getGetSeriesQueryKey,
  getListSeriesQueryKey,
  getListStoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, Loader2, Plus, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SeriesDetailPage() {
  const [, params] = useRoute("/series/:id");
  const seriesId = Number(params?.id);
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pickStoryId, setPickStoryId] = useState<string>("");
  const [titleDraft, setTitleDraft] = useState("");

  const queryKey = getGetSeriesQueryKey(seriesId);
  const { data: series, isLoading } = useGetSeries(seriesId, {
    query: { queryKey, enabled: !!seriesId },
  });

  const myStoriesParams = { authorName: authorName || "" };
  const { data: myStories } = useListStories(myStoriesParams, {
    query: {
      enabled: !!authorName?.trim(),
      queryKey: getListStoriesQueryKey(myStoriesParams),
    },
  });

  const isOwner = !!series && !!authorName && series.authorName === authorName;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: getListSeriesQueryKey({}) });
  };

  const update = useUpdateSeries({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({ title: "Series updated" });
      },
    },
  });
  const del = useDeleteSeries({
    mutation: {
      onSuccess: () => {
        toast({ title: "Series deleted" });
        window.history.back();
      },
    },
  });
  const add = useAddStoryToSeries({
    mutation: {
      onSuccess: () => {
        refresh();
        setPickStoryId("");
      },
    },
  });
  const removeStory = useRemoveStoryFromSeries({
    mutation: { onSuccess: () => refresh() },
  });

  if (isLoading || !series) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          <Skeleton className="h-10 w-1/2 mb-4" />
          <Skeleton className="h-6 w-1/3 mb-8" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Layout>
    );
  }

  const storyIdsAlready = new Set((series.stories ?? []).map((s) => s.id));
  const candidates = (myStories ?? []).filter((s) => !storyIdsAlready.has(s.id));

  return (
    <Layout>
      <Seo title={series.title} description={series.summary ?? undefined} />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="font-serif text-3xl md:text-4xl font-bold mb-2">
          {series.title}
        </h1>
        {series.summary && (
          <p className="text-muted-foreground mb-6">{series.summary}</p>
        )}
        <p className="text-xs text-muted-foreground italic mb-8">
          by {series.authorName} · {series.stories?.length ?? 0} stories
        </p>

        {isOwner && (
          <div className="mb-8 p-4 rounded-xl bg-card/40 border border-border/50 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                placeholder={series.title}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="max-w-sm"
              />
              <Button
                size="sm"
                disabled={!titleDraft.trim() || update.isPending}
                onClick={() =>
                  update.mutate({
                    id: seriesId,
                    data: { title: titleDraft, requesterAuthorName: authorName },
                  })
                }
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm("Delete this series? Stories themselves are kept.")) {
                    del.mutate({
                      id: seriesId,
                      params: { requesterAuthorName: authorName },
                    });
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Delete series
              </Button>
            </div>

            <div className="flex gap-2 items-center pt-2 border-t border-border/30">
              <Select value={pickStoryId} onValueChange={setPickStoryId}>
                <SelectTrigger className="max-w-xs">
                  <SelectValue placeholder="Pick a story to add" />
                </SelectTrigger>
                <SelectContent>
                  {candidates.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No more stories to add
                    </SelectItem>
                  ) : (
                    candidates.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!pickStoryId || add.isPending}
                onClick={() =>
                  add.mutate({
                    id: seriesId,
                    data: {
                      storyId: Number(pickStoryId),
                      position: (series.stories?.length ?? 0) + 1,
                      requesterAuthorName: authorName,
                    },
                  })
                }
              >
                {add.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-1" />
                )}
                Add story
              </Button>
            </div>
          </div>
        )}

        {(series.stories ?? []).length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border/50 rounded-2xl">
            <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground italic">
              No stories in this series yet.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {(series.stories ?? []).map((s, idx) => (
              <li key={s.id}>
                <Card>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs text-muted-foreground tabular-nums mr-2">
                        #{idx + 1}
                      </span>
                      <Link
                        href={`/story/${s.id}`}
                        className="font-serif font-semibold hover:text-primary"
                      >
                        {s.title}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.genre}
                      </p>
                    </div>
                    {isOwner && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          removeStory.mutate({
                            id: seriesId,
                            storyId: s.id,
                            params: { requesterAuthorName: authorName },
                          })
                        }
                        aria-label="Remove from series"
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Layout>
  );
}

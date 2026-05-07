import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { useAuthor } from "@/hooks/use-author";
import {
  useListBookmarks,
  useListReadingHistory,
  getListBookmarksQueryKey,
  getListReadingHistoryQueryKey,
} from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Bookmark, History, BookOpen } from "lucide-react";

const VIRTUALIZE_THRESHOLD = 20;

function useParentOffset(): {
  ref: React.RefObject<HTMLDivElement | null>;
  offset: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const update = (): void => {
      if (!ref.current) return;
      setOffset(ref.current.getBoundingClientRect().top + window.scrollY);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return { ref, offset };
}

type BookmarkRow = {
  id: number;
  storyId: number;
  story?: { title?: string | null; summary?: string | null; authorName?: string | null } | null;
};

function BookmarksGrid({ rows }: { rows: BookmarkRow[] }) {
  const { t } = useTranslation();
  const { ref, offset } = useParentOffset();
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const update = (): void => {
      setCols(window.innerWidth >= 768 ? 2 : 1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const rowCount = Math.ceil(rows.length / cols);
  const rowHeight = 168;
  const gap = 16;
  const v = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight + gap,
    overscan: 4,
    scrollMargin: offset,
  });
  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height: v.getTotalSize() }}
      data-testid="library-bookmarks-virtual"
    >
      {v.getVirtualItems().map((row) => {
        const start = row.index * cols;
        const slice = rows.slice(start, start + cols);
        return (
          <div
            key={row.key}
            className="absolute left-0 right-0 grid grid-cols-1 md:grid-cols-2 gap-4"
            style={{ transform: `translateY(${row.start - v.options.scrollMargin}px)` }}
          >
            {slice.map((b) => (
              <Link key={b.id} href={`/story/${b.storyId}`}>
                <Card className="cursor-pointer hover:bg-accent/30 transition-colors">
                  <CardHeader>
                    <CardTitle className="font-serif text-lg line-clamp-1">
                      {b.story?.title ?? t("common.untitled")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    <p className="line-clamp-2">{b.story?.summary}</p>
                    <p className="mt-2 italic">
                      {t("common.by")} {b.story?.authorName}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}

type HistoryRow = {
  storyId: number;
  progress: number;
  story?: { title?: string | null; authorName?: string | null } | null;
};

function HistoryList({ rows }: { rows: HistoryRow[] }) {
  const { t } = useTranslation();
  const { ref, offset } = useParentOffset();
  const rowHeight = 80;
  const gap = 12;
  const v = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight + gap,
    overscan: 6,
    scrollMargin: offset,
  });
  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height: v.getTotalSize() }}
      data-testid="library-history-virtual"
    >
      {v.getVirtualItems().map((row) => {
        const h = rows[row.index];
        return (
          <div
            key={row.key}
            className="absolute left-0 right-0"
            style={{
              transform: `translateY(${row.start - v.options.scrollMargin}px)`,
              height: rowHeight,
            }}
          >
            <Link href={`/story/${h.storyId}`}>
              <Card className="cursor-pointer hover:bg-accent/30 transition-colors">
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-serif text-base truncate">
                      {h.story?.title ?? t("common.untitled")}
                    </p>
                    <p className="text-xs text-muted-foreground italic truncate">
                      {t("common.by")} {h.story?.authorName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm tabular-nums font-medium">{h.progress}%</p>
                    <div className="w-24 h-1.5 mt-1 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${h.progress}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        );
      })}
    </div>
  );
}

export default function LibraryPage() {
  const { t } = useTranslation();
  const { authorName } = useAuthor();
  const recipient = authorName?.trim() ?? "";
  const enabled = !!recipient;

  const { data: bookmarks, isLoading: bmLoading } = useListBookmarks(
    recipient || "x",
    { query: { enabled, queryKey: getListBookmarksQueryKey(recipient || "x") } },
  );
  const { data: history, isLoading: hLoading } = useListReadingHistory(
    recipient || "x",
    { query: { enabled, queryKey: getListReadingHistoryQueryKey(recipient || "x") } },
  );

  const bookmarkRows = (bookmarks ?? []) as BookmarkRow[];
  const historyRows = (history ?? []) as HistoryRow[];

  return (
    <Layout>
      <Seo title={t("library.seoTitle")} description={t("library.seoDesc")} />
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="font-serif text-3xl md:text-4xl font-bold mb-2">{t("library.title")}</h1>
          <p className="text-muted-foreground">{t("library.subtitle")}</p>
        </div>

        {!enabled ? (
          <div className="text-center py-24 border border-dashed border-border/50 rounded-2xl bg-card/10">
            <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">{t("library.setPenName")}</p>
          </div>
        ) : (
          <Tabs defaultValue="bookmarks">
            <TabsList>
              <TabsTrigger value="bookmarks" data-testid="tab-library-bookmarks">
                <Bookmark className="w-4 h-4 mr-2" /> {t("library.bookmarks")}
              </TabsTrigger>
              <TabsTrigger value="history" data-testid="tab-library-history">
                <History className="w-4 h-4 mr-2" /> {t("library.history")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="bookmarks" className="mt-6">
              {bmLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Skeleton className="h-28" />
                  <Skeleton className="h-28" />
                </div>
              ) : bookmarkRows.length === 0 ? (
                <p className="text-muted-foreground italic">{t("library.noBookmarks")}</p>
              ) : bookmarkRows.length < VIRTUALIZE_THRESHOLD ? (
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {bookmarkRows.map((b) => (
                    <li key={b.id}>
                      <Link href={`/story/${b.storyId}`}>
                        <Card className="cursor-pointer hover:bg-accent/30 transition-colors">
                          <CardHeader>
                            <CardTitle className="font-serif text-lg line-clamp-1">
                              {b.story?.title ?? t("common.untitled")}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="text-sm text-muted-foreground">
                            <p className="line-clamp-2">{b.story?.summary}</p>
                            <p className="mt-2 italic">
                              {t("common.by")} {b.story?.authorName}
                            </p>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <BookmarksGrid rows={bookmarkRows} />
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              {hLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              ) : historyRows.length === 0 ? (
                <p className="text-muted-foreground italic">{t("library.noHistory")}</p>
              ) : historyRows.length < VIRTUALIZE_THRESHOLD ? (
                <ul className="space-y-3">
                  {historyRows.map((h) => (
                    <li key={h.storyId}>
                      <Link href={`/story/${h.storyId}`}>
                        <Card className="cursor-pointer hover:bg-accent/30 transition-colors">
                          <CardContent className="p-4 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <p className="font-serif text-base truncate">
                                {h.story?.title ?? t("common.untitled")}
                              </p>
                              <p className="text-xs text-muted-foreground italic truncate">
                                {t("common.by")} {h.story?.authorName}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm tabular-nums font-medium">
                                {h.progress}%
                              </p>
                              <div className="w-24 h-1.5 mt-1 bg-secondary rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary transition-all"
                                  style={{ width: `${h.progress}%` }}
                                />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <HistoryList rows={historyRows} />
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Layout>
  );
}

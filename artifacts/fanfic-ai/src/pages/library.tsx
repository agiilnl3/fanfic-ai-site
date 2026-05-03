import { Link } from "wouter";
import { useTranslation } from "react-i18next";
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
              ) : (bookmarks ?? []).length === 0 ? (
                <p className="text-muted-foreground italic">{t("library.noBookmarks")}</p>
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(bookmarks ?? []).map((b) => (
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
                            <p className="mt-2 italic">{t("common.by")} {b.story?.authorName}</p>
                          </CardContent>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              {hLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              ) : (history ?? []).length === 0 ? (
                <p className="text-muted-foreground italic">{t("library.noHistory")}</p>
              ) : (
                <ul className="space-y-3">
                  {(history ?? []).map((h) => (
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
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Layout>
  );
}

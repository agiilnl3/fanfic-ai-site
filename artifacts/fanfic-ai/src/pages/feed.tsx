import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import {
  useGetPublicFeed,
  useListTags,
  getListTagsQueryKey,
  type Story,
  type GetPublicFeedParams,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { StoryCard } from "@/components/story-card";
import { AuthorSearch } from "@/components/author-search";
import { Input } from "@/components/ui/input";
import { Search, BookOpen, Users, Globe } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useAuthor } from "@/hooks/use-author";

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const GENRES = [
  "All Genres",
  "Fantasy", "High Fantasy", "Dark Fantasy",
  "Romance", "Paranormal Romance",
  "Science Fiction", "Space Opera", "Cyberpunk", "Solarpunk",
  "Mystery", "Thriller", "Noir",
  "Horror", "Gothic Horror",
  "Adventure", "Historical", "Contemporary",
  "Fairy Tale", "Mythology",
  "Steampunk", "Dystopian",
];

const VIRTUALIZE_THRESHOLD = 50;

function useColumnCount() {
  const compute = () => {
    if (typeof window === "undefined") return 4;
    const w = window.innerWidth;
    if (w >= 1024) return 4;
    if (w >= 768) return 3;
    if (w >= 640) return 2;
    return 1;
  };
  const [cols, setCols] = useState(compute);
  useEffect(() => {
    const onResize = () => setCols(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

function VirtualGrid({ stories }: { stories: Story[] }) {
  const cols = useColumnCount();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [parentOffset, setParentOffset] = useState(0);

  useEffect(() => {
    if (!parentRef.current) return;
    const update = () => {
      if (parentRef.current) {
        setParentOffset(parentRef.current.getBoundingClientRect().top + window.scrollY);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const rowCount = Math.ceil(stories.length / cols);
  const rowHeight = 460;
  const gap = 24;

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight + gap,
    overscan: 4,
    scrollMargin: parentOffset,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((row) => {
        const startIdx = row.index * cols;
        const endIdx = Math.min(startIdx + cols, stories.length);
        const rowStories = stories.slice(startIdx, endIdx);
        return (
          <div
            key={row.key}
            className={`absolute left-0 right-0 grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4`}
            style={{
              transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            {rowStories.map((story) => (
              <StoryCard key={story.id} story={story} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

type SortMode = NonNullable<GetPublicFeedParams["sort"]>;

function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function Feed() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("All Genres");
  const [tab, setTab] = useState<"all" | "following">("all");
  const [sort, setSort] = useState<SortMode>("new");
  const [tag, setTag] = useState<string | null>(() => readQueryParam("tag"));
  const debouncedSearch = useDebounced(search, 300);
  const { authorName } = useAuthor();

  const followingEnabled = tab === "following" && !!authorName?.trim();

  const { data: tagsData } = useListTags({
    query: { queryKey: getListTagsQueryKey(), staleTime: 60_000 },
  });

  const { data: feed, isLoading } = useGetPublicFeed({
    genre: genre === "All Genres" ? undefined : genre,
    q: debouncedSearch.trim() || undefined,
    followerName: followingEnabled ? authorName : undefined,
    sort,
    tag: tag ?? undefined,
    viewerAuthorName: authorName?.trim() || undefined,
  });

  const filteredFeed = feed;

  return (
    <Layout>
      <Seo
        title={t("feed.seoTitle")}
        description={t("feed.seoDesc")}
      />
      <div className="container mx-auto px-4 py-12">
        <div className="flex flex-col items-center mb-12 text-center">
          <h1 className="font-serif text-4xl md:text-5xl font-bold mb-4 glow-text">{t("feed.title")}</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">
            {t("feed.subtitle")}
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "following")} className="max-w-3xl mx-auto mb-6">
          <TabsList className="grid grid-cols-2 w-full md:w-auto md:inline-flex">
            <TabsTrigger value="all" className="gap-2" data-testid="tab-feed-all">
              <Globe className="w-4 h-4" /> {t("feed.allStories")}
            </TabsTrigger>
            <TabsTrigger value="following" className="gap-2" data-testid="tab-feed-following">
              <Users className="w-4 h-4" /> {t("feed.following")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col md:flex-row gap-4 mb-12 max-w-3xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder={t("feed.searchPlaceholder")}
              className="pl-10 h-12 bg-card/50 backdrop-blur-sm border-primary/20 text-lg"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-feed-search"
            />
          </div>
          <Select value={genre} onValueChange={setGenre}>
            <SelectTrigger className="w-full md:w-[200px] h-12 bg-card/50 border-primary/20">
              <SelectValue placeholder={t("feed.genre")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {GENRES.map((g) => (
                <SelectItem key={g} value={g}>
                  {g === "All Genres" ? t("feed.allGenres") : t(`genres.${g}`, g)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="max-w-3xl mx-auto mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{t("feed.sort")}</span>
          <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
            <SelectTrigger
              className="w-[170px] h-9 bg-card/50 border-primary/20"
              data-testid="select-feed-sort"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{t("feed.sortNew")}</SelectItem>
              <SelectItem value="today">{t("feed.sortToday")}</SelectItem>
              <SelectItem value="week">{t("feed.sortWeek")}</SelectItem>
              <SelectItem value="all">{t("feed.sortAll")}</SelectItem>
            </SelectContent>
          </Select>
          {tag && (
            <Badge
              variant="outline"
              role="button"
              tabIndex={0}
              aria-label={t("feed.clearTagAria", { tag })}
              className="cursor-pointer gap-2"
              onClick={() => setTag(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTag(null);
                }
              }}
              data-testid="badge-active-tag"
            >
              #{tag}
              <span aria-hidden>×</span>
            </Badge>
          )}
        </div>

        {(tagsData ?? []).length > 0 && (
          <div className="max-w-3xl mx-auto mb-8 flex flex-wrap gap-2">
            {(tagsData ?? []).slice(0, 24).map((tg) => {
              const active = tag === tg.slug;
              return (
                <Badge
                  key={tg.id}
                  variant={active ? "default" : "secondary"}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={t("feed.filterByTagAria", { tag: tg.label })}
                  className="cursor-pointer hover:bg-primary/30"
                  onClick={() => setTag(active ? null : tg.slug)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setTag(active ? null : tg.slug);
                    }
                  }}
                  data-testid={`tag-chip-${tg.slug}`}
                >
                  #{tg.label}
                </Badge>
              );
            })}
          </div>
        )}

        <AuthorSearch query={debouncedSearch} />

        {tab === "following" && !authorName?.trim() ? (
          <div className="text-center py-32 border border-dashed border-border/50 rounded-2xl bg-card/10">
            <Users className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="font-serif text-2xl mb-2">{t("feed.setPenNameTitle")}</h3>
            <p className="text-muted-foreground">{t("feed.setPenNameHint")}</p>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-[300px] w-full rounded-xl" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : filteredFeed && filteredFeed.length > 0 ? (
          filteredFeed.length >= VIRTUALIZE_THRESHOLD ? (
            <VirtualGrid stories={filteredFeed} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {filteredFeed.map((story) => (
                <StoryCard key={story.id} story={story} />
              ))}
            </div>
          )
        ) : (
          <div className="text-center py-32 border border-dashed border-border/50 rounded-2xl bg-card/10">
            <BookOpen className="w-16 h-16 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="font-serif text-2xl mb-2">
              {tab === "following" ? t("feed.noFollowing") : t("feed.noTales")}
            </h3>
            <p className="text-muted-foreground">
              {tab === "following" ? t("feed.noFollowingHint") : t("feed.noTalesHint")}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}

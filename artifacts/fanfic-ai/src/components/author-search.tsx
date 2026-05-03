import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useSearchAuthors, getSearchAuthorsQueryKey } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { UserSearch, BookOpen, Users } from "lucide-react";

export function AuthorSearch({ query }: { query: string }) {
  const { t } = useTranslation();
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const { data } = useSearchAuthors(
    { q: debounced, limit: 8 },
    {
      query: {
        enabled: debounced.length >= 2,
        queryKey: getSearchAuthorsQueryKey({ q: debounced, limit: 8 }),
      },
    },
  );

  if (debounced.length < 2 || !data || data.length === 0) return null;

  return (
    <Card className="p-3 mb-6 bg-card/40 border-primary/20">
      <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
        <UserSearch className="w-4 h-4" />
        {t("authorSearch.matching")} <span className="text-foreground">"{debounced}"</span>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {data.map((hit) => (
          <li key={hit.authorName}>
            <Link
              href={`/author/${encodeURIComponent(hit.authorName)}`}
              className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent transition-colors"
              data-testid={`author-search-${hit.authorName}`}
            >
              <span className="font-medium truncate">{hit.authorName}</span>
              <span className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 ml-2">
                <span className="flex items-center gap-1">
                  <BookOpen className="w-3 h-3" />
                  {hit.publishedCount}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {hit.followerCount}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

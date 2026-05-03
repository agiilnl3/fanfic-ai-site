import { useRoute, Link } from "wouter";
import {
  useGetAuthorProfile,
  getGetAuthorProfileQueryKey,
  useListAuthorReposts,
  getListAuthorRepostsQueryKey,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { Repeat2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { StoryCard } from "@/components/story-card";
import { FollowButton } from "@/components/follow-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { BookOpen, Heart, Users, UserPlus } from "lucide-react";
import { format } from "date-fns";

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BookOpen;
  label: string;
  value: number | string;
}) {
  return (
    <Card className="p-4 flex items-center gap-3 bg-card/50">
      <Icon className="w-5 h-5 text-primary" />
      <div>
        <div className="font-serif text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      </div>
    </Card>
  );
}

export default function AuthorPage() {
  const [, params] = useRoute<{ name: string }>("/author/:name");
  const name = params?.name ? decodeURIComponent(params.name) : "";

  const { data, isLoading, error } = useGetAuthorProfile(name, {
    query: {
      enabled: !!name,
      staleTime: 60_000,
      queryKey: getGetAuthorProfileQueryKey(name),
    },
  });

  const { data: reposts } = useListAuthorReposts(name, {
    query: {
      enabled: !!name,
      staleTime: 60_000,
      queryKey: getListAuthorRepostsQueryKey(name),
    },
  });

  return (
    <Layout>
      <Seo
        title={name ? `${name} — FanFic AI` : "Author"}
        description={name ? `Stories and profile for author ${name} on FanFic AI.` : ""}
      />
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        {isLoading && (
          <div className="space-y-6">
            <Skeleton className="h-32 w-full" />
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-[400px] w-full rounded-xl" />
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="text-center py-32">
            <h1 className="font-serif text-3xl mb-2">Author not found</h1>
            <p className="text-muted-foreground">
              No public profile for <span className="italic">{name}</span>.
            </p>
            <Link href="/feed" className="text-primary underline mt-4 inline-block">
              Back to library
            </Link>
          </div>
        )}
        {data && (
          <>
            <div className="mb-10">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
                <div>
                  <h1 className="font-serif text-4xl md:text-5xl font-bold glow-text">
                    {data.authorName}
                  </h1>
                  {data.firstSeenAt && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Joined the realm {format(new Date(data.firstSeenAt), "MMMM yyyy")}
                    </p>
                  )}
                </div>
                <FollowButton authorName={data.authorName} size="default" showCount />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={BookOpen} label="Published" value={data.publishedCount} />
                <StatCard icon={Heart} label="Total Likes" value={data.totalLikes} />
                <StatCard icon={Users} label="Followers" value={data.followerCount} />
                <StatCard icon={UserPlus} label="Following" value={data.followingCount} />
              </div>
            </div>

            <h2 className="font-serif text-2xl mb-6">Published tales</h2>
            {data.stories.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-border/50 rounded-2xl bg-card/10">
                <BookOpen className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">
                  {data.authorName} hasn't published any stories yet.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {data.stories.map((story) => (
                  <StoryCard key={story.id} story={story} />
                ))}
              </div>
            )}

            {reposts && reposts.length > 0 && (
              <div className="mt-12">
                <h2 className="font-serif text-2xl mb-2 flex items-center gap-2">
                  <Repeat2 className="w-5 h-5 text-primary" />
                  Reposted tales
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Stories {data.authorName} has shared with their followers.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {reposts.map((entry) => (
                    <div key={entry.repostId} className="space-y-2">
                      <StoryCard story={entry.story} />
                      <div className="text-xs text-muted-foreground px-1">
                        Reposted {formatDistanceToNow(new Date(entry.repostedAt), { addSuffix: true })}
                        {entry.note ? ` — “${entry.note}”` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

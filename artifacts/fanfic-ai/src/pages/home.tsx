import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetStoryStats, useGetPublicFeed } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { Button } from "@/components/ui/button";
import { StoryCard } from "@/components/story-card";
import { Sparkles, BookOpen, PenTool, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { t } = useTranslation();
  const { data: stats, isLoading: statsLoading } = useGetStoryStats();
  const { data: feed, isLoading: feedLoading } = useGetPublicFeed({ limit: 4 });

  return (
    <Layout>
      <Seo />
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 overflow-hidden flex flex-col items-center justify-center min-h-[70vh]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />

        <div className="container mx-auto px-4 relative z-10 text-center max-w-4xl">
          <Badge className="mb-6 bg-primary/10 text-primary border-primary/20 backdrop-blur-sm hover:bg-primary/20">
            <Sparkles className="w-3 h-3 mr-2" /> {t("home.badge")}
          </Badge>
          <h1 className="font-serif text-5xl md:text-7xl font-bold tracking-tight mb-6 glow-text text-foreground">
            {t("home.heroTitle1")} <br/><span className="text-primary italic">{t("home.heroTitle2")}</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            {t("home.heroSubtitle")}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/create">
              <Button size="lg" className="w-full sm:w-auto text-lg h-14 px-8 bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_hsl(var(--primary)/0.3)]">
                {t("home.startWriting")} <PenTool className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link href="/feed">
              <Button size="lg" variant="outline" className="w-full sm:w-auto text-lg h-14 px-8 border-primary/30 hover:bg-primary/10">
                {t("home.exploreLibrary")} <BookOpen className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats Strip */}
        <div className="container mx-auto px-4 mt-24">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 max-w-4xl mx-auto">
            <StatBox label={t("home.statStories")} value={statsLoading ? "-" : stats?.totalStories} />
            <StatBox label={t("home.statPublished")} value={statsLoading ? "-" : stats?.publishedStories} />
            <StatBox label={t("home.statIllustrations")} value={statsLoading ? "-" : stats?.totalIllustrations} />
            <StatBox label={t("home.statGenres")} value={statsLoading ? "-" : stats?.genreBreakdown?.length || 0} />
          </div>
        </div>
      </section>

      {/* Featured Stories */}
      <section className="py-24 bg-secondary/30 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-3">{t("home.recentTitle")}</h2>
              <p className="text-muted-foreground">{t("home.recentSubtitle")}</p>
            </div>
            <Link href="/feed">
              <Button variant="ghost" className="hidden md:flex">
                {t("home.viewAll")} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </div>

          {feedLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="space-y-3">
                  <Skeleton className="h-[300px] w-full rounded-xl" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : feed && feed.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {feed.map(story => (
                <StoryCard key={story.id} story={story} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              {t("home.noStoriesYet")}
            </div>
          )}

          <div className="mt-8 flex justify-center md:hidden">
            <Link href="/feed">
              <Button variant="outline">
                {t("home.viewAllStories")} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function StatBox({ label, value }: { label: string, value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl">
      <div className="text-3xl md:text-4xl font-serif font-bold text-primary mb-2">{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</div>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode, className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${className}`}>
      {children}
    </span>
  );
}

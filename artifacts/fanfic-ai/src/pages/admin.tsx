import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminLogin,
  useAdminListStories,
  useAdminGetStats,
  useAdminDeleteStory,
  useAdminUpdateStory,
  useAdminGetTariff,
  useAdminUpdateTariff,
  useAdminGetMetrics,
  useAdminListReports,
  useAdminResolveReport,
  getAdminListStoriesQueryKey,
  getAdminGetStatsQueryKey,
  getAdminGetTariffQueryKey,
  getAdminGetMetricsQueryKey,
  getAdminListReportsQueryKey,
  type AdminListReportsStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  Loader2,
  ShieldCheck,
  LogOut,
  Globe,
  Lock,
  EyeOff,
  Check,
  Save,
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

const TOKEN_KEY = "fanfic_admin_token";
const TIERS = ["free", "premium"] as const;

export default function AdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  const loginMutation = useAdminLogin({
    mutation: {
      onSuccess: (res) => {
        setToken(res.token);
        setPassword("");
        toast({ title: "Welcome, admin" });
      },
      onError: () => toast({ title: "Invalid password", variant: "destructive" }),
    },
  });

  const enabled = !!token;
  const requestOptions = { headers: { "x-admin-token": token } };

  const { data: stats, error: statsError } = useAdminGetStats({
    query: { enabled, queryKey: getAdminGetStatsQueryKey() },
    request: requestOptions,
  });

  useEffect(() => {
    if (statsError && token) {
      setToken("");
      toast({ title: "Session expired", variant: "destructive" });
    }
  }, [statsError, token, toast]);

  if (!token) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-20 max-w-md">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" /> Admin Access
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (password) loginMutation.mutate({ data: { password } });
                }}
                className="space-y-4"
              >
                <Input
                  type="password"
                  placeholder="Admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  aria-label="Admin password"
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending || !password}
                  data-testid="button-admin-login"
                >
                  {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-serif text-4xl font-bold">Admin Panel</h1>
          <Button variant="outline" onClick={() => setToken("")}>
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-10">
            <StatCard label="Stories" value={stats.totalStories} />
            <StatCard label="Published" value={stats.publishedStories} />
            <StatCard label="Drafts" value={stats.draftStories} />
            <StatCard label="Illustrations" value={stats.totalIllustrations} />
            <StatCard label="Likes" value={stats.totalLikes} />
            <StatCard label="Authors" value={stats.totalAuthors} />
          </div>
        )}

        <Tabs defaultValue="stories">
          <TabsList className="mb-6">
            <TabsTrigger value="stories" data-testid="tab-stories">Stories</TabsTrigger>
            <TabsTrigger value="tariffs" data-testid="tab-tariffs">Tariffs</TabsTrigger>
            <TabsTrigger value="metrics" data-testid="tab-metrics">Metrics</TabsTrigger>
            <TabsTrigger value="reports" data-testid="tab-reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="stories">
            <StoriesTab requestOptions={requestOptions} />
          </TabsContent>
          <TabsContent value="tariffs">
            <TariffsTab requestOptions={requestOptions} />
          </TabsContent>
          <TabsContent value="metrics">
            <MetricsTab requestOptions={requestOptions} />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsTab requestOptions={requestOptions} />
          </TabsContent>
        </Tabs>
        {void queryClient}
      </div>
    </Layout>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground tracking-wide">{label}</div>
        <div className="font-serif text-3xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

type ReqOpts = { headers: { "x-admin-token": string } };

function StoriesTab({ requestOptions }: { requestOptions: ReqOpts }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: stories, isLoading } = useAdminListStories({
    query: { queryKey: getAdminListStoriesQueryKey() },
    request: requestOptions,
  });
  const deleteMutation = useAdminDeleteStory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListStoriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
        toast({ title: "Story deleted" });
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
    request: requestOptions,
  });
  const updateMutation = useAdminUpdateStory({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListStoriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getAdminGetStatsQueryKey() });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    },
    request: requestOptions,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>All Stories</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Author</th>
                  <th className="py-2 pr-4">Genre</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Likes</th>
                  <th className="py-2 pr-4">Ill.</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(stories ?? []).map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/story/${s.id}`} className="font-medium hover:text-primary">
                        {s.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{s.authorName}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="secondary">{s.genre}</Badge>
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={s.status === "published" ? "default" : "outline"}>
                        {s.status === "published" ? (
                          <><Globe className="w-3 h-3 mr-1" /> published</>
                        ) : (
                          <><Lock className="w-3 h-3 mr-1" /> draft</>
                        )}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">{s.likeCount}</td>
                    <td className="py-2 pr-4">{s.illustrationCount}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {format(new Date(s.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="mr-2"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            id: s.id,
                            data: { status: s.status === "published" ? "draft" : "published" },
                          })
                        }
                      >
                        {s.status === "published" ? "Unpublish" : "Publish"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (confirm(`Delete "${s.title}"? This cannot be undone.`)) {
                            deleteMutation.mutate({ id: s.id });
                          }
                        }}
                        aria-label={`Delete ${s.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {(stories ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No stories yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TariffsTab({ requestOptions }: { requestOptions: ReqOpts }) {
  return (
    <div className="grid md:grid-cols-2 gap-6">
      {TIERS.map((tier) => (
        <TariffCard key={tier} tier={tier} requestOptions={requestOptions} />
      ))}
    </div>
  );
}

function TariffCard({
  tier,
  requestOptions,
}: {
  tier: string;
  requestOptions: ReqOpts;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdminGetTariff(tier, {
    query: { queryKey: getAdminGetTariffQueryKey(tier) },
    request: requestOptions,
  });
  const [story, setStory] = useState<string>("");
  const [ill, setIll] = useState<string>("");
  useEffect(() => {
    if (data) {
      setStory(String(data.storyDailyLimit));
      setIll(String(data.illustrationDailyLimit));
    }
  }, [data]);

  const update = useAdminUpdateTariff({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminGetTariffQueryKey(tier) });
        toast({ title: `Tariff ${tier} updated` });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    },
    request: requestOptions,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">Tariff: {tier}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const s = parseInt(story, 10);
              const i = parseInt(ill, 10);
              if (Number.isNaN(s) || Number.isNaN(i)) return;
              update.mutate({
                tier,
                data: { storyDailyLimit: s, illustrationDailyLimit: i },
              });
            }}
          >
            <div>
              <label className="text-sm text-muted-foreground" htmlFor={`s-${tier}`}>
                Stories per day
              </label>
              <Input
                id={`s-${tier}`}
                type="number"
                min={0}
                max={1000}
                value={story}
                onChange={(e) => setStory(e.target.value)}
                data-testid={`input-tariff-stories-${tier}`}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground" htmlFor={`i-${tier}`}>
                Illustrations per day
              </label>
              <Input
                id={`i-${tier}`}
                type="number"
                min={0}
                max={5000}
                value={ill}
                onChange={(e) => setIll(e.target.value)}
                data-testid={`input-tariff-ills-${tier}`}
              />
            </div>
            <Button
              type="submit"
              disabled={update.isPending}
              data-testid={`button-save-tariff-${tier}`}
            >
              {update.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save
            </Button>
            {data && (
              <p className="text-xs text-muted-foreground">
                Last updated {format(new Date(data.updatedAt), "MMM d, yyyy h:mm a")}
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function MetricsTab({ requestOptions }: { requestOptions: ReqOpts }) {
  const { data, isLoading } = useAdminGetMetrics({
    query: { queryKey: getAdminGetMetricsQueryKey() },
    request: requestOptions,
  });

  const maxActive = useMemo(() => {
    if (!data?.dailyActive?.length) return 1;
    return Math.max(
      ...data.dailyActive.map((d) => Math.max(d.authors, d.stories)),
      1,
    );
  }, [data]);

  if (isLoading || !data) {
    return <Loader2 className="w-6 h-6 animate-spin" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Daily activity (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-32" role="img" aria-label="Daily active authors and stories">
            {data.dailyActive.slice(0, 30).reverse().map((d) => (
              <div
                key={d.day}
                className="flex-1 flex flex-col justify-end gap-px"
                title={`${d.day}: ${d.authors} authors, ${d.stories} stories`}
              >
                <div
                  className="bg-primary/60 rounded-t"
                  style={{ height: `${(d.authors / maxActive) * 100}%` }}
                />
                <div
                  className="bg-amber-400/60"
                  style={{ height: `${(d.stories / maxActive) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span><span className="inline-block w-3 h-3 bg-primary/60 mr-1 align-middle" />Authors</span>
            <span><span className="inline-block w-3 h-3 bg-amber-400/60 mr-1 align-middle" />Stories</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top authors</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Author</th>
                  <th className="py-2 text-right">Stories</th>
                  <th className="py-2 text-right">Likes</th>
                  <th className="py-2 text-right">Followers</th>
                </tr>
              </thead>
              <tbody>
                {data.topAuthors.map((a) => (
                  <tr key={a.authorName} className="border-b last:border-0">
                    <td className="py-2">{a.authorName}</td>
                    <td className="py-2 text-right tabular-nums">{a.storyCount}</td>
                    <td className="py-2 text-right tabular-nums">{a.likeCount}</td>
                    <td className="py-2 text-right tabular-nums">{a.followerCount}</td>
                  </tr>
                ))}
                {data.topAuthors.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      No data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top stories</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Title</th>
                  <th className="py-2 text-right">Likes</th>
                  <th className="py-2 text-right">Reposts</th>
                  <th className="py-2 text-right">Comments</th>
                </tr>
              </thead>
              <tbody>
                {data.topStories.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2">
                      <Link href={`/story/${s.id}`} className="hover:text-primary">
                        {s.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        by {s.authorName}
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{s.likeCount}</td>
                    <td className="py-2 text-right tabular-nums">{s.repostCount}</td>
                    <td className="py-2 text-right tabular-nums">{s.commentCount}</td>
                  </tr>
                ))}
                {data.topStories.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      No data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReportsTab({ requestOptions }: { requestOptions: ReqOpts }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AdminListReportsStatus>("open");
  const params = { status };
  const { data: reports, isLoading } = useAdminListReports(params, {
    query: { queryKey: getAdminListReportsQueryKey(params) },
    request: requestOptions,
  });
  const resolve = useAdminResolveReport({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getAdminListReportsQueryKey(params) });
        toast({ title: "Report resolved" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    },
    request: requestOptions,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Moderation reports</span>
          <div className="flex gap-2">
            {(["open", "hidden", "dismissed"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? "default" : "outline"}
                onClick={() => setStatus(s)}
                data-testid={`button-reports-${s}`}
              >
                {s}
              </Button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (reports ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm py-6 text-center">
            No {status} reports.
          </p>
        ) : (
          <ul className="space-y-3">
            {(reports ?? []).map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-border/50 p-4 bg-card/40"
                data-testid={`report-${r.id}`}
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div>
                    <Badge variant="secondary" className="mr-2">
                      {r.targetType}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      #{r.targetId} · reported by {r.reporterName} ·{" "}
                      {format(new Date(r.createdAt), "MMM d, yyyy h:mm a")}
                    </span>
                  </div>
                  <Badge variant={r.status === "open" ? "default" : "outline"}>
                    {r.status}
                  </Badge>
                </div>
                {r.reason && (
                  <p className="text-sm mb-2 text-foreground/90">{r.reason}</p>
                )}
                {r.targetPreview && (
                  <p className="text-sm italic text-muted-foreground border-l-2 border-border pl-3 mb-3 line-clamp-3">
                    {r.targetPreview}
                  </p>
                )}
                {r.targetType === "story" && (
                  <Link
                    href={`/story/${r.targetId}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Open story →
                  </Link>
                )}
                {status === "open" && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({ id: r.id, data: { action: "hide" } })
                      }
                      data-testid={`button-hide-${r.id}`}
                    >
                      <EyeOff className="w-3.5 h-3.5 mr-1" /> Hide
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({ id: r.id, data: { action: "dismiss" } })
                      }
                      data-testid={`button-dismiss-${r.id}`}
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> Dismiss
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

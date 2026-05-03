import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuthor } from "@/hooks/use-author";
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
  useAdminListUsers,
  useAdminSetUserBanned,
  getAdminListStoriesQueryKey,
  getAdminGetStatsQueryKey,
  getAdminGetTariffQueryKey,
  getAdminGetMetricsQueryKey,
  getAdminListReportsQueryKey,
  getAdminListUsersQueryKey,
  type AdminListReportsStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Trash2,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  LogOut,
  Globe,
  Lock,
  EyeOff,
  Check,
  Save,
  LayoutDashboard,
  BookOpen,
  Coins,
  Flag,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

const TOKEN_KEY = "fanfic_admin_token";
const TIERS = ["free", "premium"] as const;
type ReqOpts = { headers?: { "x-admin-token"?: string } };

type TabId = "overview" | "stories" | "tariffs" | "reports" | "users";

const TABS: ReadonlyArray<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "reports", label: "Reports", icon: Flag },
  { id: "users", label: "Users", icon: Users },
  { id: "stories", label: "Stories", icon: BookOpen },
  { id: "tariffs", label: "Tariffs", icon: Coins },
];

export default function AdminPage() {
  const { toast } = useToast();
  const { isAdmin, isSignedIn } = useAuthor();
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("overview");

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

  // A signed-in admin user gets through on the Clerk session — no token needed.
  // Otherwise we fall back to the legacy x-admin-token flow.
  const authedViaClerk = isSignedIn && isAdmin;
  const enabled = authedViaClerk || !!token;
  const requestOptions: ReqOpts = useMemo(
    () => (authedViaClerk ? {} : { headers: { "x-admin-token": token } }),
    [authedViaClerk, token],
  );

  const { data: stats, error: statsError } = useAdminGetStats({
    query: { enabled, queryKey: getAdminGetStatsQueryKey() },
    request: requestOptions,
  });

  useEffect(() => {
    if (statsError && token && !authedViaClerk) {
      setToken("");
      toast({ title: "Session expired", variant: "destructive" });
    }
  }, [statsError, token, authedViaClerk, toast]);

  if (!enabled) {
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
              <p className="text-sm text-muted-foreground mb-4">
                Sign in with an admin account, or enter the emergency
                admin password below.
              </p>
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
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-serif text-4xl font-bold">Admin Panel</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {authedViaClerk ? "Signed in via admin account" : "Token session"}
            </p>
          </div>
          {!authedViaClerk && (
            <Button variant="outline" onClick={() => setToken("")}>
              <LogOut className="w-4 h-4 mr-2" /> Sign out
            </Button>
          )}
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

        <div className="grid md:grid-cols-[200px_1fr] gap-6">
          <nav
            className="md:sticky md:top-20 md:self-start flex md:flex-col gap-1 overflow-x-auto md:overflow-visible"
            aria-label="Admin sections"
          >
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  data-testid={`tab-${t.id}`}
                  className={
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors " +
                    (active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground hover:text-foreground")
                  }
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          <div className="min-w-0">
            {activeTab === "overview" && <MetricsTab requestOptions={requestOptions} />}
            {activeTab === "stories" && <StoriesTab requestOptions={requestOptions} />}
            {activeTab === "tariffs" && <TariffsTab requestOptions={requestOptions} />}
            {activeTab === "reports" && <ReportsTab requestOptions={requestOptions} />}
            {activeTab === "users" && <UsersTab requestOptions={requestOptions} />}
          </div>
        </div>
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

  // Recharts wants oldest → newest left-to-right.
  const dailyAsc = useMemo(() => {
    if (!data?.dailyActive) return [];
    return [...data.dailyActive].sort((a, b) => (a.day < b.day ? -1 : 1));
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
          <div className="h-72" data-testid="chart-daily-active">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyAsc} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="authors" name="Active authors" fill="hsl(var(--primary))" />
                <Bar dataKey="stories" name="Stories created" fill="#fbbf24" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Top authors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72" data-testid="chart-top-authors">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.topAuthors}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="authorName"
                    width={90}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="storyCount" name="Stories" fill="hsl(var(--primary))" />
                  <Bar dataKey="likeCount" name="Likes" fill="#fbbf24" />
                  <Bar dataKey="followerCount" name="Followers" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top stories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72" data-testid="chart-top-stories">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.topStories.map((s) => ({
                    ...s,
                    label: s.title.length > 24 ? s.title.slice(0, 22) + "…" : s.title,
                  }))}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="likeCount" name="Likes" fill="hsl(var(--primary))" />
                  <Bar dataKey="repostCount" name="Reposts" fill="#fbbf24" />
                  <Bar dataKey="commentCount" name="Comments" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              {data.topStories.map((s) => (
                <li key={s.id} className="flex justify-between gap-2">
                  <Link
                    href={`/story/${s.id}`}
                    className="truncate hover:text-primary"
                    title={s.title}
                  >
                    {s.title}
                  </Link>
                  <span className="text-muted-foreground whitespace-nowrap">
                    by {s.authorName}
                  </span>
                </li>
              ))}
              {data.topStories.length === 0 && (
                <li className="text-muted-foreground text-center py-4">No data yet.</li>
              )}
            </ul>
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

function UsersTab({ requestOptions }: { requestOptions: ReqOpts }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const usersKey = getAdminListUsersQueryKey({ limit: 100 });
  const { data: users, isLoading } = useAdminListUsers(
    { limit: 100 },
    { query: { queryKey: usersKey }, request: requestOptions },
  );
  const setBanned = useAdminSetUserBanned({
    mutation: {
      onSuccess: (_res, vars) => {
        queryClient.invalidateQueries({ queryKey: usersKey });
        toast({
          title: vars.data.banned ? "User banned" : "User unbanned",
        });
      },
      onError: () => toast({ title: "Action failed", variant: "destructive" }),
    },
    request: requestOptions,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent users</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (users ?? []).length === 0 ? (
          <p className="text-muted-foreground text-sm py-6 text-center">No users.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-4">Handle</th>
                  <th className="py-2 pr-4">Display name</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Stories</th>
                  <th className="py-2 pr-4">Joined</th>
                  <th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((u) => (
                  <tr
                    key={u.id}
                    className="border-b last:border-0"
                    data-testid={`user-row-${u.id}`}
                  >
                    <td className="py-2 pr-4 font-mono">
                      <Link
                        href={`/author/${u.handle}`}
                        className="hover:text-primary"
                      >
                        @{u.handle}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{u.displayName}</td>
                    <td className="py-2 pr-4">
                      {u.banned ? (
                        <Badge variant="destructive">
                          <ShieldOff className="w-3 h-3 mr-1" /> banned
                        </Badge>
                      ) : u.isAdmin ? (
                        <Badge variant="default">
                          <ShieldCheck className="w-3 h-3 mr-1" /> admin
                        </Badge>
                      ) : (
                        <Badge variant="outline">user</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{u.storyCount}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {format(new Date(u.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">
                      {u.banned ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setBanned.isPending}
                          onClick={() =>
                            setBanned.mutate({ id: u.id, data: { banned: false } })
                          }
                          data-testid={`button-unban-${u.id}`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Unban
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={setBanned.isPending}
                          onClick={() => {
                            if (
                              confirm(`Ban @${u.handle}? They won't be able to post.`)
                            ) {
                              setBanned.mutate({
                                id: u.id,
                                data: { banned: true },
                              });
                            }
                          }}
                          data-testid={`button-ban-${u.id}`}
                        >
                          <ShieldAlert className="w-3.5 h-3.5 mr-1" /> Ban
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

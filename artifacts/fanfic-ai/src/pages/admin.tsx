import { useEffect, useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminLogin,
  useAdminListStories,
  useAdminGetStats,
  useAdminDeleteStory,
  useAdminUpdateStory,
  getAdminListStoriesQueryKey,
  getAdminGetStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Loader2, ShieldCheck, LogOut, Globe, Lock } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

const TOKEN_KEY = "fanfic_admin_token";

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
  const { data: stories, isLoading } = useAdminListStories({
    query: { enabled, queryKey: getAdminListStoriesQueryKey() },
    request: requestOptions,
  });

  useEffect(() => {
    if (statsError && token) {
      // Token rejected — clear it.
      setToken("");
      toast({ title: "Session expired", variant: "destructive" });
    }
  }, [statsError, token, toast]);

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
                />
                <Button type="submit" className="w-full" disabled={loginMutation.isPending || !password}>
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

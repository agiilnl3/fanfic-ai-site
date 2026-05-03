import { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  useGetUnreadNotificationCount,
  useListNotifications,
  useMarkNotificationsRead,
  getGetUnreadNotificationCountQueryKey,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthor } from "@/hooks/use-author";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, MessageCircle, UserPlus, Heart, Repeat2, BookPlus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

function iconForType(type: string) {
  if (type === "comment") return MessageCircle;
  if (type === "follow") return UserPlus;
  if (type === "like") return Heart;
  if (type === "repost") return Repeat2;
  if (type === "co_author_chapter") return BookPlus;
  return Sparkles;
}

function summarize(n: {
  type: string;
  actorName: string;
  payload?: Record<string, unknown> | null;
}) {
  const title = (n.payload?.storyTitle as string | undefined) ?? "your story";
  if (n.type === "comment") return `${n.actorName} commented on “${title}”`;
  if (n.type === "follow") return `${n.actorName} started following you`;
  if (n.type === "like") return `${n.actorName} liked “${title}”`;
  if (n.type === "repost") return `${n.actorName} reposted “${title}”`;
  if (n.type === "co_author_chapter") return `${n.actorName} added a chapter to “${title}”`;
  return `${n.actorName}: ${n.type}`;
}

export function NotificationsBell() {
  const { authorName } = useAuthor();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const recipient = authorName?.trim() || "";
  const enabled = !!recipient;

  const unreadKey = getGetUnreadNotificationCountQueryKey({ recipientName: recipient });
  const listKey = getListNotificationsQueryKey({ recipientName: recipient, limit: 30 });

  const { data: countData } = useGetUnreadNotificationCount(
    { recipientName: recipient },
    { query: { enabled, refetchInterval: 60_000, queryKey: unreadKey } },
  );
  const { data: notifications } = useListNotifications(
    { recipientName: recipient, limit: 30 },
    { query: { enabled: enabled && open, queryKey: listKey } },
  );

  // Live updates over Server-Sent Events: any nudge invalidates unread/list caches.
  useEffect(() => {
    if (!enabled) return;
    const url = `/api/notifications/stream?recipientName=${encodeURIComponent(recipient)}`;
    const es = new EventSource(url);
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: unreadKey });
      queryClient.invalidateQueries({ queryKey: listKey });
    };
    es.addEventListener("ping", refresh);
    es.onerror = () => {
      // browser auto-reconnects; nothing to do.
    };
    return () => {
      es.removeEventListener("ping", refresh);
      es.close();
    };
  }, [enabled, recipient, queryClient, unreadKey, listKey]);

  const markRead = useMarkNotificationsRead({
    mutation: {
      onSuccess: (next) => {
        queryClient.setQueryData(unreadKey, next);
        const nowIso = new Date().toISOString();
        queryClient.setQueryData(listKey, (old: typeof notifications) =>
          old?.map((n) => (n.readAt ? n : { ...n, readAt: nowIso })),
        );
      },
    },
  });

  if (!enabled) return null;

  const unread = countData?.unread ?? 0;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && unread > 0) {
      markRead.mutate({ data: { recipientName: recipient } });
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
          data-testid="button-notifications"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-h-[70vh] overflow-y-auto p-0"
      >
        <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between">
          <span className="font-medium text-sm">Notifications</span>
          <span className="text-xs text-muted-foreground">@{recipient}</span>
        </div>
        {notifications && notifications.length > 0 ? (
          <ul className="divide-y divide-border/50">
            {notifications.map((n) => {
              const Icon = iconForType(n.type);
              const href = n.storyId ? `/story/${n.storyId}` : `/author/${encodeURIComponent(n.actorName)}`;
              return (
                <li key={n.id}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex gap-3 px-3 py-2.5 hover:bg-accent transition-colors",
                      !n.readAt && "bg-primary/5",
                    )}
                  >
                    <Icon className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm leading-snug">{summarize(n)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No notifications yet.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

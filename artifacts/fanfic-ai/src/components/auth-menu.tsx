import { Show, useUser, useClerk } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { LogIn, LogOut, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAuthor } from "@/hooks/use-author";

export function AuthMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const { handle, displayName } = useUserDisplay();

  return (
    <>
      <Show when="signed-out">
        <Link href="/sign-in">
          <Button size={compact ? "icon" : "sm"} variant="ghost" data-testid="button-signin">
            <LogIn className="w-4 h-4" />
            {!compact && <span className="ml-1.5">{t("auth.signIn", "Sign in")}</span>}
          </Button>
        </Link>
        {!compact && (
          <Link href="/sign-up">
            <Button size="sm" data-testid="button-signup">
              {t("auth.signUp", "Sign up")}
            </Button>
          </Link>
        )}
      </Show>
      <Show when="signed-in">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size={compact ? "icon" : "sm"} variant="ghost" data-testid="button-user-menu">
              {user?.imageUrl ? (
                <img
                  src={user.imageUrl}
                  alt={displayName || handle}
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : (
                <UserCircle2 className="w-5 h-5" />
              )}
              {!compact && (
                <span className="ml-1.5 max-w-[120px] truncate">
                  {displayName || handle}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-medium truncate">{displayName || handle}</div>
              {handle && (
                <div className="text-xs text-muted-foreground truncate">@{handle}</div>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {handle && (
              <DropdownMenuItem onClick={() => setLocation(`/author/${handle}`)}>
                {t("auth.myProfile", "My profile")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setLocation("/settings")}>
              {t("auth.settings", "Settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut(() => setLocation("/"))}
              data-testid="button-signout"
            >
              <LogOut className="w-4 h-4 mr-2" />
              {t("auth.signOut", "Sign out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Show>
    </>
  );
}

function useUserDisplay() {
  const { authorName, displayName } = useAuthor();
  return { handle: authorName, displayName };
}

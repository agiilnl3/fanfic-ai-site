import { Link, useLocation } from "wouter";
import {
  BookOpen,
  Home,
  Library,
  PenTool,
  Sparkles,
  User,
  Bookmark,
  Settings,
  Wand2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NotificationsBell } from "@/components/notifications-bell";
import { InstallPrompt } from "@/components/install-prompt";
import { AuthMenu } from "@/components/auth-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { t } = useTranslation();

  const navItems = [
    { href: "/", label: t("nav.home"), icon: Home },
    { href: "/feed", label: t("nav.library"), icon: Library },
    { href: "/library", label: t("nav.myLibrary", "My Library"), icon: Bookmark },
    { href: "/create", label: t("nav.create"), icon: Sparkles },
    { href: "/dashboard", label: t("nav.dashboard"), icon: PenTool },
    { href: "/pricing", label: t("nav.pricing", "Pricing"), icon: Wand2 },
    { href: "/settings", label: t("nav.settings", "Settings"), icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col w-full relative overflow-x-hidden">
      {/* Ambient glow in background */}
      <div className="pointer-events-none fixed -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-[100px]" />
      <div className="pointer-events-none fixed -bottom-40 -left-40 w-96 h-96 bg-blue-900/20 rounded-full blur-[100px]" />

      <header className="border-b border-border/50 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <BookOpen className="w-6 h-6 text-primary group-hover:text-primary/80 transition-colors" />
            <span className="font-serif font-bold text-xl tracking-wide glow-text">FanFic AI</span>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                  location === item.href
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-2">
            <NotificationsBell />
            <ThemeToggle />
            <LanguageSwitcher />
            <AuthMenu />
          </div>

          <div className="md:hidden flex items-center gap-2">
            <NotificationsBell />
            <ThemeToggle compact />
            <LanguageSwitcher />
            <AuthMenu compact />
            <Link href="/create" className="text-primary flex items-center justify-center p-2">
              <Sparkles className="w-5 h-5" />
            </Link>
            <Link href="/dashboard" className="text-muted-foreground flex items-center justify-center p-2">
              <User className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile nav bottom bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border/50 bg-background/95 backdrop-blur z-50">
        <div className="flex justify-around p-3">
           {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-1 text-xs ${
                  location === item.href
                    ? "text-primary"
                    : "text-muted-foreground"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            ))}
        </div>
      </div>

      <main className="flex-1 w-full pb-20 md:pb-0">
        {children}
      </main>

      <InstallPrompt />
    </div>
  );
}

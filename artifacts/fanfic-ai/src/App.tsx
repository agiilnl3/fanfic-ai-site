import { lazy, Suspense, useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { ClerkProvider, useClerk, useUser } from "@clerk/react";
import { setSentryUser } from "@/lib/sentry";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";

import Home from "@/pages/home";
import NotFound from "@/pages/not-found";

const CreateStory = lazy(() => import("@/pages/create"));
const StoryReading = lazy(() => import("@/pages/story"));
const Feed = lazy(() => import("@/pages/feed"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Admin = lazy(() => import("@/pages/admin"));
const AuthorPage = lazy(() => import("@/pages/author"));
const Library = lazy(() => import("@/pages/library"));
const Series = lazy(() => import("@/pages/series"));
const SeriesDetail = lazy(() => import("@/pages/series-detail"));
const Settings = lazy(() => import("@/pages/settings"));
const Pricing = lazy(() => import("@/pages/pricing"));
const SignInPage = lazy(() => import("@/pages/sign-in"));
const SignUpPage = lazy(() => import("@/pages/sign-up"));

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const clerkPubKey = publishableKeyFromHost(
  typeof window !== "undefined" ? window.location.hostname : "",
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL || undefined;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl:
      typeof window !== "undefined"
        ? `${window.location.origin}${basePath}/logo.svg`
        : "/logo.svg",
  },
  variables: {
    colorPrimary: "#a78bfa",
    colorForeground: "#f5f3ff",
    colorMutedForeground: "#a1a1aa",
    colorDanger: "#ef4444",
    colorBackground: "#0b0b14",
    colorInput: "#1c1b2e",
    colorInputForeground: "#f5f3ff",
    colorNeutral: "#3f3f46",
    fontFamily: "Inter, system-ui, sans-serif",
    borderRadius: "12px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#13121f] border border-white/10 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-serif text-2xl",
    headerSubtitle: "text-zinc-300",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-zinc-200",
    footerActionLink: "text-violet-300 hover:text-violet-200",
    footerActionText: "text-zinc-400",
    dividerText: "text-zinc-500",
    identityPreviewEditButton: "text-violet-300",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-red-300",
    socialButtonsBlockButton: "border border-white/10 hover:bg-white/5",
    formButtonPrimary:
      "bg-violet-500 hover:bg-violet-400 text-white font-medium",
    formFieldInput: "bg-[#1c1b2e] border border-white/10 text-white",
    footerAction: "bg-transparent",
    dividerLine: "bg-white/10",
    alert: "border border-red-500/30 bg-red-500/10",
    otpCodeFieldInput: "bg-[#1c1b2e] border border-white/10 text-white",
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/create" component={CreateStory} />
        <Route path="/story/:id" component={StoryReading} />
        <Route path="/feed" component={Feed} />
        <Route path="/library" component={Library} />
        <Route path="/series" component={Series} />
        <Route path="/series/:id" component={SeriesDetail} />
        <Route path="/settings" component={Settings} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/admin" component={Admin} />
        <Route path="/author/:name" component={AuthorPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

// Bridges Clerk's user lifecycle into Sentry so browser errors include
// the authenticated user id/email. Lives inside ClerkProvider so the
// useUser() hook is available; renders nothing.
function SentryUserBridge() {
  const { isSignedIn, user } = useUser();
  useEffect(() => {
    if (isSignedIn && user) {
      setSentryUser({
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress,
      });
    } else {
      setSentryUser(null);
    }
  }, [isSignedIn, user]);
  return null;
}

function ClerkProviderWithRouting({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <SentryUserBridge />
        {children}
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <HelmetProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRouting>
          <TooltipProvider>
            <Router />
            <Toaster />
          </TooltipProvider>
        </ClerkProviderWithRouting>
      </WouterRouter>
    </HelmetProvider>
  );
}

export default App;

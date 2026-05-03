import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
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

const queryClient = new QueryClient();

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
        <Route path="/create" component={CreateStory} />
        <Route path="/story/:id" component={StoryReading} />
        <Route path="/feed" component={Feed} />
        <Route path="/library" component={Library} />
        <Route path="/series" component={Series} />
        <Route path="/series/:id" component={SeriesDetail} />
        <Route path="/settings" component={Settings} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/admin" component={Admin} />
        <Route path="/author/:name" component={AuthorPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;

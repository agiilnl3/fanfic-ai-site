import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Layout } from "@/components/layout";
import { Seo } from "@/components/seo";
import { useAuthor } from "@/hooks/use-author";
import {
  generateStory,
  generateIllustration,
  useListSeries,
  useAddStoryToSeries,
  useSetStoryTags,
  getListSeriesQueryKey,
} from "@workspace/api-client-react";
import { UsageMeter } from "@/components/usage-meter";
import type { Story, Illustration } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, BookOpen, PenTool, Image as ImageIcon, CheckCircle2, ArrowRight } from "lucide-react";

export const GENRES = [
  "Fantasy", "High Fantasy", "Dark Fantasy",
  "Romance", "Paranormal Romance",
  "Science Fiction", "Space Opera", "Cyberpunk", "Solarpunk",
  "Mystery", "Thriller", "Noir",
  "Horror", "Gothic Horror",
  "Adventure", "Historical", "Contemporary",
  "Fairy Tale", "Mythology",
  "Steampunk", "Dystopian",
];

export const ART_STYLES = [
  "Watercolor", "Oil Painting", "Acrylic",
  "Digital Art", "Concept Art", "Pixel Art",
  "Ink Sketch", "Pen & Ink", "Charcoal",
  "Comic Book", "Manga", "Graphic Novel",
  "Impressionist", "Art Nouveau", "Art Deco",
  "Surrealist", "Expressionist",
  "Cinematic", "Photography",
];

export const ART_STYLE_PREVIEWS: Record<string, { emoji: string; gradient: string; hint: string }> = {
  "Watercolor":      { emoji: "🎨", gradient: "from-sky-200 via-rose-200 to-amber-200", hint: "Soft, dreamlike washes" },
  "Oil Painting":    { emoji: "🖌️", gradient: "from-amber-700 via-rose-800 to-stone-900", hint: "Rich, textured strokes" },
  "Acrylic":         { emoji: "🖼️", gradient: "from-emerald-300 via-teal-400 to-cyan-500", hint: "Bold, vibrant colors" },
  "Digital Art":     { emoji: "🖥️", gradient: "from-indigo-500 via-purple-500 to-pink-500", hint: "Crisp, modern rendering" },
  "Concept Art":     { emoji: "🗺️", gradient: "from-slate-700 via-slate-900 to-amber-900", hint: "Cinematic worldbuilding" },
  "Pixel Art":       { emoji: "👾", gradient: "from-lime-400 via-emerald-500 to-cyan-500", hint: "8/16-bit retro charm" },
  "Ink Sketch":      { emoji: "✒️", gradient: "from-stone-100 via-stone-300 to-stone-700", hint: "Loose monochrome lines" },
  "Pen & Ink":       { emoji: "🖋️", gradient: "from-zinc-100 via-zinc-400 to-zinc-900", hint: "Precise crosshatching" },
  "Charcoal":        { emoji: "✏️", gradient: "from-stone-200 via-stone-500 to-neutral-900", hint: "Smoky, dramatic shading" },
  "Comic Book":      { emoji: "💥", gradient: "from-red-500 via-yellow-400 to-blue-500", hint: "Bold lines, pop colors" },
  "Manga":           { emoji: "🌸", gradient: "from-rose-200 via-fuchsia-300 to-indigo-400", hint: "Expressive Japanese style" },
  "Graphic Novel":   { emoji: "📖", gradient: "from-amber-800 via-stone-700 to-slate-900", hint: "Mature, illustrated panels" },
  "Impressionist":   { emoji: "🌅", gradient: "from-amber-200 via-rose-300 to-violet-400", hint: "Light & atmosphere" },
  "Art Nouveau":     { emoji: "🌿", gradient: "from-emerald-700 via-amber-500 to-rose-600", hint: "Elegant, organic curves" },
  "Art Deco":        { emoji: "💎", gradient: "from-amber-400 via-yellow-300 to-stone-900", hint: "Geometric luxury" },
  "Surrealist":      { emoji: "🌀", gradient: "from-indigo-600 via-fuchsia-500 to-amber-400", hint: "Dreamlike, impossible" },
  "Expressionist":   { emoji: "🔥", gradient: "from-red-600 via-orange-500 to-yellow-400", hint: "Raw emotional color" },
  "Cinematic":       { emoji: "🎬", gradient: "from-amber-600 via-stone-900 to-slate-900", hint: "Filmic lighting & framing" },
  "Photography":     { emoji: "📷", gradient: "from-stone-300 via-stone-600 to-stone-900", hint: "Photorealistic detail" },
};

type Phase = "idle" | "writing" | "illustrating" | "done";

const NUM_SECTIONS = 4;

function splitIntoSections(fullText: string, n: number): string[] {
  const paragraphs = fullText.split(/\n\n+/).filter((p) => p.trim());
  const size = Math.max(1, Math.ceil(paragraphs.length / n));
  return Array.from({ length: n }, (_, i) =>
    paragraphs.slice(i * size, (i + 1) * size).join("\n\n"),
  ).filter((s) => s.trim());
}

export default function CreateStory() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { authorName, setAuthorName } = useAuthor();
  const { toast } = useToast();
  const seriesParams = authorName?.trim() ? { authorName } : {};
  const { data: mySeries } = useListSeries(seriesParams, {
    query: {
      queryKey: getListSeriesQueryKey(seriesParams),
      enabled: !!authorName?.trim(),
    },
  });
  const addToSeriesMutation = useAddStoryToSeries();

  const [genre, setGenre] = useState<string>("Fantasy");
  const [artStyle, setArtStyle] = useState<string>("Watercolor");
  const [lengthSetting, setLengthSetting] = useState<"short" | "medium" | "long">("medium");
  const [seedPrompt, setSeedPrompt] = useState<string>("");
  const [withIllustrations, setWithIllustrations] = useState<boolean>(true);
  const [model, setModel] = useState<"gpt-5.1" | "gpt-5-mini">("gpt-5.1");
  const [seriesId, setSeriesId] = useState<string>("none");
  const [tagDraft, setTagDraft] = useState<string>("");
  const setTagsMutation = useSetStoryTags();

  const [phase, setPhase] = useState<Phase>("idle");
  const [generatedStory, setGeneratedStory] = useState<Story | null>(null);
  const [illustrations, setIllustrations] = useState<(Illustration | null)[]>([]);
  const [currentIllIdx, setCurrentIllIdx] = useState<number>(-1);

  const handleGenerate = async () => {
    if (!authorName.trim()) {
      toast({
        title: t("create.penNameRequired"),
        description: t("create.penNameRequiredDesc"),
        variant: "destructive",
      });
      return;
    }

    setPhase("writing");
    setGeneratedStory(null);
    setIllustrations([]);
    setCurrentIllIdx(-1);

    try {
      const story = await generateStory({
        genre,
        artStyle,
        lengthSetting,
        authorName: authorName.trim(),
        seedPrompt: seedPrompt.trim() || undefined,
        generateIllustrations: false,
        model,
      });
      setGeneratedStory(story);

      const tagSlugs = tagDraft
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
        .slice(0, 8);
      if (tagSlugs.length > 0) {
        try {
          await setTagsMutation.mutateAsync({
            id: story.id,
            data: { slugs: tagSlugs, requesterAuthorName: authorName.trim() },
          });
        } catch {
          toast({
            title: t("create.tagsSaveFailedTitle"),
            description: t("create.tagsSaveFailedDesc"),
            variant: "destructive",
          });
        }
      }

      if (seriesId !== "none") {
        const sid = Number(seriesId);
        if (Number.isFinite(sid)) {
          try {
            await addToSeriesMutation.mutateAsync({
              id: sid,
              data: {
                storyId: story.id,
                requesterAuthorName: authorName.trim(),
              },
            });
          } catch {
            toast({
              title: t("create.addToSeriesFailedTitle"),
              description: t("create.addToSeriesFailedDesc"),
              variant: "destructive",
            });
          }
        }
      }

      if (!withIllustrations) {
        setPhase("done");
        return;
      }

      setPhase("illustrating");
      const sections = splitIntoSections(story.fullText ?? "", NUM_SECTIONS);
      const illResults: (Illustration | null)[] = sections.map(() => null);
      setIllustrations([...illResults]);

      for (let idx = 0; idx < sections.length; idx++) {
        setCurrentIllIdx(idx);
        try {
          const ill = await generateIllustration(story.id, {
            sectionIndex: idx,
            sectionText: sections[idx],
          });
          illResults[idx] = ill;
          setIllustrations([...illResults]);
        } catch {
          illResults[idx] = null;
        }
      }

      setCurrentIllIdx(-1);
      setPhase("done");
    } catch (err) {
      setPhase("idle");
      toast({
        title: t("create.failedConjure"),
        description: err instanceof Error ? err.message : t("create.unknownError"),
        variant: "destructive",
      });
    }
  };

  if (phase === "writing") {
    return (
      <Layout>
        <div className="min-h-[70vh] flex flex-col items-center justify-center space-y-10 animate-in fade-in duration-700">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <div className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <Sparkles className="w-12 h-12 text-primary animate-pulse" />
          </div>
          <div className="text-center space-y-3 max-w-md">
            <h2 className="font-serif text-3xl font-bold glow-text">{t("create.writingTitle")}</h2>
            <p className="text-muted-foreground">{t("create.writingDesc")}</p>
            <p className="text-sm text-muted-foreground/60 italic mt-4">
              {t("create.writingHint")}
            </p>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>{t("create.writingStep")}</span>
            </div>
            {withIllustrations && (
              <div className="flex items-center gap-2 opacity-40">
                <ImageIcon className="w-4 h-4" />
                <span>{t("create.illsPending")}</span>
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  if ((phase === "illustrating" || phase === "done") && generatedStory) {
    const totalIlls = illustrations.length || NUM_SECTIONS;
    const doneCount = illustrations.filter(Boolean).length;

    return (
      <Layout>
        <div className="container mx-auto px-4 py-12 max-w-3xl animate-in fade-in duration-700">
          <div className="text-center mb-8">
            {phase === "done" ? (
              <>
                <CheckCircle2 className="w-12 h-12 text-primary mx-auto mb-4" />
                <h2 className="font-serif text-3xl font-bold glow-text mb-2">{t("create.readyTitle")}</h2>
                <p className="text-muted-foreground">{t("create.readyDesc", { title: generatedStory.title })}</p>
              </>
            ) : (
              <>
                <div className="relative w-12 h-12 mx-auto mb-4">
                  <div className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
                <h2 className="font-serif text-3xl font-bold glow-text mb-2">{t("create.paintingTitle")}</h2>
                <p className="text-muted-foreground">
                  {t("create.paintingProgress", { done: doneCount, total: totalIlls })}
                </p>
              </>
            )}
          </div>

          <Card className="bg-card/50 backdrop-blur-sm border-primary/10 mb-6">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge className="mb-2 text-xs">{t(`genres.${generatedStory.genre}`, generatedStory.genre)} · {t(`artStyles.${generatedStory.artStyle}`, generatedStory.artStyle)}</Badge>
                  <CardTitle className="font-serif text-2xl">{generatedStory.title}</CardTitle>
                  {generatedStory.summary && (
                    <CardDescription className="mt-2 text-sm leading-relaxed">
                      {generatedStory.summary}
                    </CardDescription>
                  )}
                </div>
                <BookOpen className="w-8 h-8 text-primary/40 shrink-0 mt-1" />
              </div>
            </CardHeader>

            {withIllustrations && (
              <CardContent>
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3">{t("create.illustrationsLabel")}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array.from({ length: totalIlls }, (_, idx) => {
                    const ill = illustrations[idx];
                    const isActive = currentIllIdx === idx;
                    return (
                      <div key={idx} className="aspect-square rounded-lg overflow-hidden bg-muted/30 relative">
                        {ill ? (
                          <img
                            src={ill.imageUrl}
                            alt={`Illustration ${idx + 1}`}
                            className="w-full h-full object-cover animate-in fade-in duration-500"
                          />
                        ) : isActive ? (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                            <span className="text-xs text-muted-foreground">{t("create.painting")}</span>
                          </div>
                        ) : (
                          <Skeleton className="w-full h-full" />
                        )}
                        <div className="absolute bottom-1 right-1">
                          {ill && (
                            <div className="w-4 h-4 rounded-full bg-primary/80 flex items-center justify-center">
                              <CheckCircle2 className="w-3 h-3 text-white" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>

          <div className="flex gap-3 justify-center">
            {phase === "done" ? (
              <Button
                className="h-12 px-8 text-base font-serif"
                onClick={() => setLocation(`/story/${generatedStory.id}`)}
              >
                <BookOpen className="w-4 h-4 mr-2" />
                {t("create.readYourStory")}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            ) : (
              <Button
                variant="outline"
                className="h-12 px-8 text-base"
                onClick={() => setLocation(`/story/${generatedStory.id}`)}
              >
                <ArrowRight className="w-4 h-4 mr-2" />
                {t("create.openStoryNow")}
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-12 px-6"
              onClick={() => {
                setPhase("idle");
                setGeneratedStory(null);
                setIllustrations([]);
              }}
            >
              {t("create.startOver")}
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Seo
        title={t("create.title")}
        description={t("create.subtitle")}
      />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="text-center mb-10">
            <h1 className="font-serif text-4xl font-bold mb-4">{t("create.blankPageTitle")}</h1>
            <p className="text-muted-foreground text-lg">{t("create.blankPageSubtitle")}</p>
          </div>

          <Card className="bg-card/50 backdrop-blur-sm border-primary/10 shadow-[0_0_40px_hsl(var(--primary)/0.05)]">
            <CardHeader>
              <CardTitle className="font-serif flex items-center text-2xl">
                <PenTool className="w-5 h-5 mr-2 text-primary" />
                {t("create.storyParameters")}
              </CardTitle>
              <CardDescription>{t("create.storyParametersDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="authorName">{t("create.yourPenName")}</Label>
                  <Input
                    id="authorName"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder={t("create.penNamePlaceholder")}
                    className="bg-background/50"
                  />
                  {authorName.trim() && <UsageMeter authorName={authorName.trim()} />}
                </div>

                <div className="space-y-2">
                  <Label>{t("create.length")}</Label>
                  <Select value={lengthSetting} onValueChange={(val) => setLengthSetting(val as "short" | "medium" | "long")}>
                    <SelectTrigger className="bg-background/50">
                      <SelectValue placeholder={t("create.lengthSelect")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">{t("create.lengthShort")}</SelectItem>
                      <SelectItem value="medium">{t("create.lengthMedium")}</SelectItem>
                      <SelectItem value="long">{t("create.lengthLong")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("create.genre")}</Label>
                  <Select value={genre} onValueChange={setGenre}>
                    <SelectTrigger className="bg-background/50">
                      <SelectValue placeholder={t("create.selectGenre")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {GENRES.map((g) => (
                        <SelectItem key={g} value={g}>{t(`genres.${g}`, g)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("create.illustrationStyle")}</Label>
                  <Select value={artStyle} onValueChange={setArtStyle}>
                    <SelectTrigger className="bg-background/50">
                      <SelectValue placeholder={t("create.selectArtStyle")} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {ART_STYLES.map((s) => {
                        const p = ART_STYLE_PREVIEWS[s];
                        return (
                          <SelectItem key={s} value={s}>
                            <span className="mr-2">{p?.emoji ?? "🎨"}</span>{t(`artStyles.${s}`, s)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {ART_STYLE_PREVIEWS[artStyle] && (
                    <div
                      className={`mt-2 rounded-lg p-3 flex items-center gap-3 bg-gradient-to-br ${ART_STYLE_PREVIEWS[artStyle].gradient} text-white shadow-inner`}
                      data-testid="art-style-preview"
                    >
                      <span className="text-3xl drop-shadow">{ART_STYLE_PREVIEWS[artStyle].emoji}</span>
                      <div className="flex-1">
                        <div className="font-serif font-semibold drop-shadow-sm">{t(`artStyles.${artStyle}`, artStyle)}</div>
                        <div className="text-xs opacity-90 drop-shadow-sm">{t(`artStyleHints.${artStyle}`, ART_STYLE_PREVIEWS[artStyle].hint)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2 pt-4">
                <Label>{t("create.model")}</Label>
                <Select value={model} onValueChange={(val) => setModel(val as "gpt-5.1" | "gpt-5-mini")}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-5.1">{t("create.modelHigh")}</SelectItem>
                    <SelectItem value="gpt-5-mini">{t("create.modelFast")}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("create.modelHelp")}
                </p>
              </div>

              <div className="space-y-2 pt-4">
                <Label htmlFor="series">{t("create.seriesOptional")}</Label>
                <Select value={seriesId} onValueChange={setSeriesId}>
                  <SelectTrigger
                    id="series"
                    className="bg-background/50"
                    data-testid="select-series"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("create.noSeries")}</SelectItem>
                    {(mySeries ?? []).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("create.seriesHelp")}
                </p>
              </div>

              <div className="space-y-2 pt-4">
                <Label htmlFor="tags">{t("create.tagsOptional")}</Label>
                <Input
                  id="tags"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder={t("create.tagsPlaceholder")}
                  data-testid="input-create-tags"
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">
                  {t("create.tagsHelp")}
                </p>
              </div>

              <div className="space-y-2 pt-4">
                <Label htmlFor="seedPrompt">{t("create.seedPrompt")}</Label>
                <Textarea
                  id="seedPrompt"
                  value={seedPrompt}
                  onChange={(e) => setSeedPrompt(e.target.value)}
                  placeholder={t("create.seedPromptPlaceholder")}
                  className="h-32 bg-background/50 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  {t("create.seedPromptHelp")}
                </p>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/50">
                <div className="space-y-0.5">
                  <Label className="flex items-center text-base">
                    <ImageIcon className="w-4 h-4 mr-2" />
                    {t("create.withIllustrations")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("create.withIllustrationsDesc")}
                  </p>
                </div>
                <Switch
                  checked={withIllustrations}
                  onCheckedChange={setWithIllustrations}
                />
              </div>

              <Button
                className="w-full h-14 text-lg font-serif mt-6"
                onClick={handleGenerate}
              >
                <Sparkles className="mr-2 w-5 h-5" />
                {t("create.generate")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}

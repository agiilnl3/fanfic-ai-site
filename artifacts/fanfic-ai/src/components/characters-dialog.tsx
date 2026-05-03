import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCharacters,
  useListStoryCharacters,
  useListSeriesCharacters,
  useCreateCharacter,
  useUpdateCharacter,
  useDeleteCharacter,
  useUploadCharacterReference,
  useSetStoryCharacters,
  getListCharactersQueryKey,
  getListStoryCharactersQueryKey,
  getListSeriesCharactersQueryKey,
  type Character,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2, Upload, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Mode = "story" | "series";

type Props = {
  mode: Mode;
  ownerHandle: string;
  storyId?: number;
  seriesId?: number | null;
  trigger: React.ReactNode;
};

const MAX_REF_DECODED_BYTES = 4 * 1024 * 1024;

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

export function CharactersDialog({
  mode,
  ownerHandle,
  storyId,
  seriesId,
  trigger,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busyRef, setBusyRef] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", description: "" });
  const [linked, setLinked] = useState<Set<number>>(new Set());
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const myCharsKey = getListCharactersQueryKey({
    ownerHandle,
    ...(mode === "series" && seriesId != null ? { seriesId } : {}),
  });
  const { data: myCharacters, isLoading: loadingMine } = useListCharacters(
    {
      ownerHandle,
      ...(mode === "series" && seriesId != null ? { seriesId } : {}),
    },
    {
      query: {
        enabled: open && !!ownerHandle,
        queryKey: myCharsKey,
      },
    },
  );

  const storyLinkKey = storyId
    ? getListStoryCharactersQueryKey(storyId)
    : ["noop"];
  const { data: storyLinkedRows } = useListStoryCharacters(storyId ?? 0, {
    query: {
      enabled: open && mode === "story" && !!storyId,
      queryKey: storyLinkKey,
    },
  });

  // Optionally show series-level characters when this story belongs to one,
  // so the author can quickly attach them too.
  const seriesPoolKey = seriesId
    ? getListSeriesCharactersQueryKey(seriesId)
    : ["noop"];
  const { data: seriesPool } = useListSeriesCharacters(seriesId ?? 0, {
    query: {
      enabled: open && mode === "story" && !!seriesId,
      queryKey: seriesPoolKey,
    },
  });

  useEffect(() => {
    if (storyLinkedRows) {
      setLinked(new Set(storyLinkedRows.map((c) => c.id)));
    }
  }, [storyLinkedRows]);

  const allCharacters = useMemo(() => {
    const out = new Map<number, Character>();
    for (const c of myCharacters ?? []) out.set(c.id, c);
    for (const c of seriesPool ?? []) out.set(c.id, c);
    if (storyLinkedRows) {
      for (const c of storyLinkedRows) out.set(c.id, c);
    }
    return Array.from(out.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [myCharacters, seriesPool, storyLinkedRows]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: myCharsKey });
    if (storyId) {
      qc.invalidateQueries({ queryKey: getListStoryCharactersQueryKey(storyId) });
    }
    if (seriesId) {
      qc.invalidateQueries({
        queryKey: getListSeriesCharactersQueryKey(seriesId),
      });
    }
  };

  const create = useCreateCharacter({
    mutation: {
      onSuccess: (newChar) => {
        setName("");
        setDescription("");
        // In story mode, auto-link the freshly-created character to the
        // current story so the author doesn't have to tick a box and
        // hit "Save selection" — they came from the story page expecting
        // this character to participate in this story.
        if (mode === "story" && newChar?.id) {
          setLinked((prev) => {
            const next = new Set(prev);
            next.add(newChar.id);
            return next;
          });
        }
        invalidate();
      },
      onError: () =>
        toast({
          title: t("characters.createFailed", "Could not create character"),
          variant: "destructive",
        }),
    },
  });
  const update = useUpdateCharacter({
    mutation: {
      onSuccess: () => {
        setEditingId(null);
        invalidate();
      },
      onError: () =>
        toast({
          title: t("characters.updateFailed", "Could not update character"),
          variant: "destructive",
        }),
    },
  });
  const del = useDeleteCharacter({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () =>
        toast({
          title: t("characters.deleteFailed", "Could not delete character"),
          variant: "destructive",
        }),
    },
  });
  const uploadRef = useUploadCharacterReference({
    mutation: {
      onSuccess: () => {
        setBusyRef(null);
        invalidate();
        toast({
          title: t("characters.referenceSaved", "Reference image uploaded"),
        });
      },
      onError: () => {
        setBusyRef(null);
        toast({
          title: t(
            "characters.referenceFailed",
            "Could not upload reference image",
          ),
          variant: "destructive",
        });
      },
    },
  });
  const setLinks = useSetStoryCharacters({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({
          title: t(
            "characters.linksSaved",
            "Story characters updated",
          ),
        });
        setOpen(false);
      },
      onError: () =>
        toast({
          title: t("characters.linksFailed", "Could not save selection"),
          variant: "destructive",
        }),
    },
  });

  const onCreate = () => {
    if (!name.trim()) return;
    create.mutate({
      data: {
        ownerHandle,
        name: name.trim(),
        description: description.trim(),
        ...(mode === "series" && seriesId != null ? { seriesId } : {}),
      },
    });
  };

  const onPickReference = async (
    characterId: number,
    file: File | undefined,
  ) => {
    if (!file) return;
    if (file.size > MAX_REF_DECODED_BYTES) {
      toast({
        title: t(
          "characters.referenceTooLarge",
          "Image is too large (max 4 MB)",
        ),
        variant: "destructive",
      });
      return;
    }
    setBusyRef(characterId);
    try {
      const b64 = await fileToBase64(file);
      const ct =
        file.type === "image/jpeg" || file.type === "image/webp"
          ? file.type
          : "image/png";
      uploadRef.mutate({
        id: characterId,
        data: { ownerHandle, imageBase64: b64, contentType: ct },
      });
    } catch {
      setBusyRef(null);
      toast({
        title: t("characters.referenceFailed", "Could not upload reference image"),
        variant: "destructive",
      });
    }
  };

  const onSaveLinks = () => {
    if (!storyId) return;
    setLinks.mutate({
      id: storyId,
      data: { ownerHandle, characterIds: Array.from(linked) },
    });
  };

  const showLinkColumn = mode === "story" && !!storyId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "story"
              ? t("characters.titleForStory", "Characters in this story")
              : t("characters.titleForSeries", "Series characters")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "characters.helpText",
              "Add reusable characters with a name, description, and optional reference image. The illustrator will use these so the same characters look the same across illustrations.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border border-border/40 rounded-xl p-3">
          <p className="text-sm font-medium">
            {t("characters.addNew", "Add a character")}
          </p>
          <Input
            placeholder={t("characters.namePlaceholder", "Name (e.g. Mira)")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
          <Textarea
            placeholder={t(
              "characters.descPlaceholder",
              "Visual description: hair, eyes, age, signature outfit, accessories…",
            )}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={3}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={onCreate}
              disabled={!name.trim() || create.isPending}
            >
              {create.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              {t("characters.add", "Add character")}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {loadingMine ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : allCharacters.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">
              {t(
                "characters.empty",
                "No characters yet. Create one above to get started.",
              )}
            </p>
          ) : (
            allCharacters.map((c) => {
              const isEditing = editingId === c.id;
              return (
                <div
                  key={c.id}
                  className="flex gap-3 items-start border border-border/40 rounded-xl p-3"
                >
                  {showLinkColumn && (
                    <Checkbox
                      checked={linked.has(c.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(linked);
                        if (v) next.add(c.id);
                        else next.delete(c.id);
                        setLinked(next);
                      }}
                      aria-label={t(
                        "characters.linkToStory",
                        "Use in this story",
                      )}
                      className="mt-1"
                    />
                  )}
                  <div className="w-16 h-16 rounded-lg bg-muted/40 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {c.referenceImageUrl ? (
                      <img
                        src={c.referenceImageUrl}
                        alt={c.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <Input
                          value={editDraft.name}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, name: e.target.value })
                          }
                        />
                        <Textarea
                          value={editDraft.description}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              description: e.target.value,
                            })
                          }
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              update.mutate({
                                id: c.id,
                                data: {
                                  ownerHandle,
                                  name: editDraft.name.trim(),
                                  description: editDraft.description.trim(),
                                },
                              })
                            }
                            disabled={
                              !editDraft.name.trim() || update.isPending
                            }
                          >
                            {update.isPending && (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            )}
                            {t("common.save", "Save")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            {t("common.cancel", "Cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold truncate">{c.name}</p>
                          <div className="flex gap-1 flex-shrink-0">
                            <input
                              ref={(el) => {
                                fileInputs.current[c.id] = el;
                              }}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) =>
                                onPickReference(c.id, e.target.files?.[0])
                              }
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              title={t(
                                "characters.uploadReference",
                                "Upload reference image",
                              )}
                              onClick={() => fileInputs.current[c.id]?.click()}
                              disabled={busyRef === c.id}
                            >
                              {busyRef === c.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Upload className="w-4 h-4" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(c.id);
                                setEditDraft({
                                  name: c.name,
                                  description: c.description ?? "",
                                });
                              }}
                              title={t("common.edit", "Edit")}
                            >
                              ✎
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                if (
                                  confirm(
                                    t(
                                      "characters.confirmDelete",
                                      "Delete this character?",
                                    ),
                                  )
                                ) {
                                  del.mutate({
                                    id: c.id,
                                    params: { ownerHandle },
                                  });
                                }
                              }}
                              title={t("common.delete", "Delete")}
                            >
                              <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </div>
                        </div>
                        {c.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-3">
                            {c.description}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {showLinkColumn && (
          <div className="flex justify-end gap-2 pt-2 border-t border-border/30">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={onSaveLinks}
              disabled={setLinks.isPending}
            >
              {setLinks.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {t("characters.saveSelection", "Save selection")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

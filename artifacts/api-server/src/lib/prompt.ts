export interface CharacterRef {
  name: string;
  description: string;
  referenceImageUrl?: string | null;
}

export function buildIllustrationPrompt(
  sectionText: string,
  genre: string,
  artStyle: string,
  characters: string | null | undefined,
  summary: string | null | undefined,
  structuredCharacters?: CharacterRef[] | null,
): string {
  const storyContext = summary
    ? ` Story context: ${summary.slice(0, 200)}.`
    : "";

  // Prefer structured per-character profiles if any are linked — they
  // give the model far better consistency than the freeform `characters`
  // blurb. Fall back to the freeform blurb only when no structured
  // characters exist.
  let characterHint = "";
  if (structuredCharacters && structuredCharacters.length > 0) {
    const lines = structuredCharacters
      .slice(0, 4)
      .map((c) => {
        const desc = (c.description ?? "").slice(0, 200);
        return desc
          ? `${c.name}: ${desc}`
          : c.name;
      })
      .join("; ");
    characterHint = ` Featured characters (keep their appearance consistent across illustrations): ${lines}.`;
  } else if (characters) {
    characterHint = ` Characters: ${characters.slice(0, 200)}.`;
  }

  return `${artStyle} illustration for a ${genre} story.${storyContext}${characterHint} Scene: ${sectionText.slice(0, 300)}. High quality, detailed, no text or watermarks.`;
}

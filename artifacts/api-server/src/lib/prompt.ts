export function buildIllustrationPrompt(
  sectionText: string,
  genre: string,
  artStyle: string,
  characters: string | null | undefined,
  summary: string | null | undefined,
): string {
  const characterHint = characters
    ? ` Characters: ${characters.slice(0, 200)}.`
    : "";
  const storyContext = summary
    ? ` Story context: ${summary.slice(0, 200)}.`
    : "";
  return `${artStyle} illustration for a ${genre} story.${storyContext}${characterHint} Scene: ${sectionText.slice(0, 300)}. High quality, detailed, no text or watermarks.`;
}

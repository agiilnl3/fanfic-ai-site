import { describe, it, expect } from "vitest";
import { buildIllustrationPrompt } from "./prompt";

describe("buildIllustrationPrompt", () => {
  it("includes art style and genre", () => {
    const out = buildIllustrationPrompt("a knight rides", "Fantasy", "Watercolor", null, null);
    expect(out).toContain("Watercolor illustration");
    expect(out).toContain("Fantasy story");
    expect(out).toContain("Scene: a knight rides");
  });

  it("includes character hint when provided", () => {
    const out = buildIllustrationPrompt("scene", "Noir", "Ink Sketch", "Detective Mira, hardboiled", null);
    expect(out).toContain("Characters: Detective Mira, hardboiled");
  });

  it("includes story context when summary provided", () => {
    const out = buildIllustrationPrompt("scene", "Sci-Fi", "Concept Art", null, "A space crew finds a derelict ship.");
    expect(out).toContain("Story context: A space crew finds a derelict ship.");
  });

  it("truncates long inputs to safe lengths", () => {
    const longChars = "a".repeat(500);
    const longSummary = "b".repeat(500);
    const longScene = "c".repeat(500);
    const out = buildIllustrationPrompt(longScene, "Fantasy", "Oil", longChars, longSummary);
    expect(out).toContain("a".repeat(200));
    expect(out).not.toContain("a".repeat(201));
    expect(out).toContain("b".repeat(200));
    expect(out).not.toContain("b".repeat(201));
    expect(out).toContain("c".repeat(300));
    expect(out).not.toContain("c".repeat(301));
  });

  it("omits character/context segments when null", () => {
    const out = buildIllustrationPrompt("scene", "Romance", "Pastel", null, null);
    expect(out).not.toContain("Characters:");
    expect(out).not.toContain("Story context:");
  });

  it("always includes quality footer", () => {
    const out = buildIllustrationPrompt("x", "y", "z", null, null);
    expect(out).toContain("High quality, detailed, no text or watermarks.");
  });
});

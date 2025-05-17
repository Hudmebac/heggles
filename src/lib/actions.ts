
"use server";

import type { Thought, PinnedThought } from "@/lib/types";
import { summarizeAudio } from "@/ai/flows/summarize-audio";
import { extractKeywords } from "@/ai/flows/extract-keywords";
import { suggestCategory } from "@/ai/flows/suggest-category";
import { refineThought } from "@/ai/flows/refine-thought";

// Simulate processing recalled audio
export async function processRecalledAudio(
  rawText: string
): Promise<Omit<Thought, "id" | "timestamp">> {
  try {
    // In a real app, rawText might be a transcription from Speech-to-Text
    const transcription = rawText; // Assuming rawText is the transcription

    const summaryResult = await summarizeAudio({ transcription });
    // Keywords can also be extracted separately if summarizeAudio doesn't provide enough, or use its keywords
    const keywordsResult = await extractKeywords({ text: transcription });
    
    return {
      originalText: transcription,
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords, // Or summaryResult.keywords if preferred
    };
  } catch (error) {
    console.error("Error processing recalled audio:", error);
    throw new Error("Failed to process audio with AI.");
  }
}

// Simulate pinning a thought and getting category suggestions
export async function pinThoughtAndSuggestCategories(
  thought: Thought
): Promise<Omit<PinnedThought, "pinnedTimestamp">> {
  try {
    const categorySuggestions = await suggestCategory({ thought: thought.originalText });
    return {
      ...thought,
      categories: categorySuggestions.categories,
    };
  } catch (error)
    {
    console.error("Error pinning thought and suggesting categories:", error);
    // Return thought without categories if AI fails
    return {
      ...thought,
      categories: ["Uncategorized"],
    };
  }
}

// Clarify a thought using AI
export async function clarifyThoughtWithAI(
  transcript: string
): Promise<{ refinedTranscript: string; actionItems: string[] }> {
  try {
    const clarificationResult = await refineThought({ transcript });
    return {
      refinedTranscript: clarificationResult.refinedTranscript,
      actionItems: clarificationResult.actionItems,
    };
  } catch (error) {
    console.error("Error clarifying thought:", error);
    throw new Error("Failed to clarify thought with AI.");
  }
}

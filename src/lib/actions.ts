
"use server";

import type { Thought, PinnedThought } from "@/lib/types";
import { summarizeAudio } from "@/ai/flows/summarize-audio";
import { extractKeywords } from "@/ai/flows/extract-keywords";
import { suggestCategory } from "@/ai/flows/suggest-category";
import { refineThought } from "@/ai/flows/refine-thought";
import { ACTUAL_RECORDING_SIMULATED_TRANSCRIPTION } from "@/lib/constants";

// Process text-based thoughts (e.g., manual input)
export async function processTextThought(
  rawText: string
): Promise<Omit<Thought, "id" | "timestamp">> {
  try {
    const transcription = rawText;

    const summaryResult = await summarizeAudio({ transcription });
    const keywordsResult = await extractKeywords({ text: transcription });
    
    return {
      originalText: transcription,
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
    };
  } catch (error) {
    console.error("Error processing text thought:", error);
    throw new Error("Failed to process text input with AI.");
  }
}

// Process recorded audio data (simulates STT for now)
export async function processRecordedAudio(
  audioDataUrl: string // In a real scenario, this might be sent to an STT service
): Promise<Omit<Thought, "id" | "timestamp">> {
  try {
    // Simulate Speech-to-Text: In a real app, you'd send audioDataUrl to an STT API.
    // For now, we use a placeholder transcription.
    const transcription = ACTUAL_RECORDING_SIMULATED_TRANSCRIPTION;
    console.log("Processing recorded audio - Data URL received (first 100 chars):", audioDataUrl.substring(0,100));


    const summaryResult = await summarizeAudio({ transcription });
    const keywordsResult = await extractKeywords({ text: transcription });
    
    return {
      originalText: transcription, // This will be the placeholder text
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
      // Optionally, you could store the audioDataUrl or a reference if needed later
      // audioSource: "recorded_snippet", // Example metadata
    };
  } catch (error) {
    console.error("Error processing recorded audio:", error);
    throw new Error("Failed to process recorded audio with AI.");
  }
}


// Pin a thought and get category suggestions
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

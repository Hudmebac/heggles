
"use server";

import type { Thought, PinnedThought } from "@/lib/types";
import { summarizeAudio } from "@/ai/flows/summarize-audio";
import { extractKeywords } from "@/ai/flows/extract-keywords";
import { suggestCategory } from "@/ai/flows/suggest-category";
import { refineThought } from "@/ai/flows/refine-thought";

// Process text-based thoughts (e.g., manual input)
export async function processTextThought(
  rawText: string
): Promise<Omit<Thought, "id" | "timestamp">> {
  try {
    const transcription = rawText; // Use the provided text directly as the transcription

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

// Process recorded audio data by using the live transcription provided from the client
export async function processRecordedAudio(
  audioDataUrl: string, // Kept for potential future use (e.g. playback) but not for STT here
  transcription: string // This is the live transcription from the 10s recording period
): Promise<Omit<Thought, "id" | "timestamp">> {
  try {
    // Log receipt of audio data for debugging, but it's not sent to STT service here
    console.log("Processing recorded audio - Data URL received (first 100 chars):", audioDataUrl.substring(0,100));
    console.log("Processing recorded audio - Using provided live transcription:", transcription);

    if (!transcription || transcription.trim() === "") {
      // Handle cases where the live transcription might be empty
      // You could return a default thought, or specific message
      return {
        originalText: "[No speech detected during recording]",
        summary: "No speech was detected during the recording.",
        keywords: [],
      };
    }

    const summaryResult = await summarizeAudio({ transcription }); // Use the live transcription
    const keywordsResult = await extractKeywords({ text: transcription }); // Use the live transcription
    
    return {
      originalText: transcription, // This is the key change - using the live transcription
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
    };
  } catch (error) {
    console.error("Error processing recorded audio with live transcription:", error);
    throw new Error("Failed to process recorded audio with AI using live transcription.");
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

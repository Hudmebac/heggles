
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
    const transcription = rawText; 

    // Perform all AI processing steps
    const [summaryResult, keywordsResult, refinementResult] = await Promise.all([
      summarizeAudio({ transcription }),
      extractKeywords({ text: transcription }),
      refineThought({ transcript: transcription })
    ]);
    
    return {
      originalText: transcription,
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
      refinedTranscript: refinementResult.refinedTranscript,
      actionItems: refinementResult.actionItems,
    };
  } catch (error) {
    console.error("Error processing text thought:", error);
    // Return a partial result or a more structured error
    return {
        originalText: rawText,
        summary: "Error during AI processing.",
        keywords: [],
        refinedTranscript: rawText, // Fallback
        actionItems: [`Error: ${(error as Error).message}`], 
    };
  }
}

// Process recorded audio data by using the live transcription provided from the client
export async function processRecordedAudio(
  audioDataUrl: string, 
  transcription: string 
): Promise<Omit<Thought, "id" | "timestamp">> {
  try {
    console.log("Processing recorded audio - Data URL received (first 100 chars):", audioDataUrl.substring(0,100));
    console.log("Processing recorded audio - Using provided live transcription:", transcription);

    const effectiveTranscription = transcription.trim() === "" ? "[No speech detected during recording]" : transcription;

    const [summaryResult, keywordsResult, refinementResult] = await Promise.all([
        summarizeAudio({ transcription: effectiveTranscription }),
        extractKeywords({ text: effectiveTranscription }),
        refineThought({ transcript: effectiveTranscription })
    ]);
    
    return {
      originalText: effectiveTranscription, 
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
      refinedTranscript: refinementResult.refinedTranscript,
      actionItems: refinementResult.actionItems,
    };
  } catch (error) {
    console.error("Error processing recorded audio with live transcription:", error);
    return {
        originalText: transcription,
        summary: "Error during AI processing of recorded audio.",
        keywords: [],
        refinedTranscript: transcription,
        actionItems: [`Error: ${(error as Error).message}`],
    };
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


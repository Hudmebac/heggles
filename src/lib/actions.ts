
"use server";

import type { Thought, PinnedThought, IntentAnalysisOutput } from "@/lib/types";
import { summarizeAudio } from "@/ai/flows/summarize-audio";
import { extractKeywords } from "@/ai/flows/extract-keywords";
import { suggestCategory } from "@/ai/flows/suggest-category";
import { refineThought } from "@/ai/flows/refine-thought";
import { analyzeThoughtIntent } from "@/ai/flows/analyze-thought-intent-flow";
import { answerQuestion as answerQuestionFlow } from "@/ai/flows/answer-question-flow";


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
    
    const thoughtTextForIntent = refinementResult.refinedTranscript || transcription;
    const intentAnalysisResult = await analyzeThoughtIntent({ thoughtText: thoughtTextForIntent });

    let aiAnswerResult: string | undefined = undefined;
    if (intentAnalysisResult.isQuestion && intentAnalysisResult.extractedQuestion) {
      const answerData = await answerQuestionFlow({ question: intentAnalysisResult.extractedQuestion });
      aiAnswerResult = answerData.answer;
    }
    
    return {
      originalText: transcription,
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
      refinedTranscript: refinementResult.refinedTranscript,
      actionItems: refinementResult.actionItems, // These are from refineThought, good for explicit "add to list"
      intentAnalysis: intentAnalysisResult,    // This is from analyzeThoughtIntent for broader understanding
      aiAnswer: aiAnswerResult,
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
        intentAnalysis: { isQuestion: false, isAction: false },
        aiAnswer: undefined,
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

    const thoughtTextForIntent = refinementResult.refinedTranscript || effectiveTranscription;
    const intentAnalysisResult = await analyzeThoughtIntent({ thoughtText: thoughtTextForIntent });
    
    let aiAnswerResult: string | undefined = undefined;
    if (intentAnalysisResult.isQuestion && intentAnalysisResult.extractedQuestion) {
      const answerData = await answerQuestionFlow({ question: intentAnalysisResult.extractedQuestion });
      aiAnswerResult = answerData.answer;
    }
    
    return {
      originalText: effectiveTranscription, 
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
      refinedTranscript: refinementResult.refinedTranscript,
      actionItems: refinementResult.actionItems,
      intentAnalysis: intentAnalysisResult,
      aiAnswer: aiAnswerResult,
    };
  } catch (error) {
    console.error("Error processing recorded audio with live transcription:", error);
    return {
        originalText: transcription,
        summary: "Error during AI processing of recorded audio.",
        keywords: [],
        refinedTranscript: transcription,
        actionItems: [`Error: ${(error as Error).message}`],
        intentAnalysis: { isQuestion: false, isAction: false },
        aiAnswer: undefined,
    };
  }
}


// Pin a thought and get category suggestions
export async function pinThoughtAndSuggestCategories(
  thought: Thought
): Promise<Omit<PinnedThought, "pinnedTimestamp">> {
  try {
    // Use refined transcript if available, otherwise original text for category suggestion
    const textForCategories = thought.refinedTranscript || thought.originalText;
    const categorySuggestions = await suggestCategory({ thought: textForCategories });
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

// Clarify a thought using AI (this seems to be refineThought itself)
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

// New server action to directly answer a question
export async function answerUserQuestion(question: string): Promise<string> {
  try {
    const result = await answerQuestionFlow({ question });
    return result.answer;
  } catch (error) {
    console.error("Error answering user question:", error);
    return "Sorry, I encountered an error trying to answer the question.";
  }
}

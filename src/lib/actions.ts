
"use server";

import type { Thought, PinnedThought, IntentAnalysisOutput, AnswerQuestionOutput } from "@/lib/types";
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
    const [summaryResult, keywordsResult, refinementResult, intentAnalysisResult] = await Promise.all([
      summarizeAudio({ transcription }),
      extractKeywords({ text: transcription }),
      refineThought({ transcript: transcription }),
      analyzeThoughtIntent({ thoughtText: refinementResult.refinedTranscript || transcription })
    ]);
    
    let aiAnswerResult: AnswerQuestionOutput | undefined = undefined;
    if (intentAnalysisResult.isQuestion && intentAnalysisResult.extractedQuestion) {
      aiAnswerResult = await answerQuestionFlow({ question: intentAnalysisResult.extractedQuestion });
    }
    
    return {
      originalText: transcription,
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
      refinedTranscript: refinementResult.refinedTranscript,
      actionItems: refinementResult.actionItems, 
      intentAnalysis: intentAnalysisResult,    
      aiAnswer: aiAnswerResult?.answer,
      isCreativeRequest: aiAnswerResult?.isCreativeRequest,
      isDirectionRequest: aiAnswerResult?.isDirectionRequest,
      suggestedActionText: aiAnswerResult?.suggestedActionText,
      suggestedActionLink: aiAnswerResult?.suggestedActionLink,
      aiSuggestedActionFromCreative: aiAnswerResult?.extractedActionFromCreative,
      aiSuggestedListForCreativeAction: aiAnswerResult?.suggestedListForCreativeAction,
    };
  } catch (error) {
    console.error("Detailed error in processTextThought:", error); // Enhanced logging
    // Ensure the error is an instance of Error to access the message property safely
    const errorMessage = error instanceof Error ? error.message : "Unknown AI processing error";
    return {
        originalText: rawText,
        summary: "Error during AI processing.", // This is what the user sees
        keywords: [],
        refinedTranscript: rawText, 
        actionItems: [`Error: ${errorMessage}`], 
        intentAnalysis: { 
          isQuestion: false, 
          isAction: false, 
          extractedQuestion: undefined, 
          extractedAction: undefined, 
          suggestedList: undefined 
        },
        aiAnswer: undefined,
        isCreativeRequest: false,
        isDirectionRequest: false,
        suggestedActionText: undefined,
        suggestedActionLink: undefined,
        aiSuggestedActionFromCreative: undefined,
        aiSuggestedListForCreativeAction: undefined,
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

    const [summaryResult, keywordsResult, refinementResult, intentAnalysisResult] = await Promise.all([
        summarizeAudio({ transcription: effectiveTranscription }),
        extractKeywords({ text: effectiveTranscription }),
        refineThought({ transcript: effectiveTranscription }),
        analyzeThoughtIntent({ thoughtText: refinementResult.refinedTranscript || effectiveTranscription })
    ]);

    let aiAnswerResult: AnswerQuestionOutput | undefined = undefined;
    if (intentAnalysisResult.isQuestion && intentAnalysisResult.extractedQuestion) {
      aiAnswerResult = await answerQuestionFlow({ question: intentAnalysisResult.extractedQuestion });
    }
    
    return {
      originalText: effectiveTranscription, 
      summary: summaryResult.summary,
      keywords: keywordsResult.keywords,
      refinedTranscript: refinementResult.refinedTranscript,
      actionItems: refinementResult.actionItems,
      intentAnalysis: intentAnalysisResult,
      aiAnswer: aiAnswerResult?.answer,
      isCreativeRequest: aiAnswerResult?.isCreativeRequest,
      isDirectionRequest: aiAnswerResult?.isDirectionRequest,
      suggestedActionText: aiAnswerResult?.suggestedActionText,
      suggestedActionLink: aiAnswerResult?.suggestedActionLink,
      aiSuggestedActionFromCreative: aiAnswerResult?.extractedActionFromCreative,
      aiSuggestedListForCreativeAction: aiAnswerResult?.suggestedListForCreativeAction,
    };
  } catch (error) {
    console.error("Detailed error in processRecordedAudio:", error); // Enhanced logging
    const errorMessage = error instanceof Error ? error.message : "Unknown AI processing error with recorded audio";
    return {
        originalText: transcription, // Or effectiveTranscription
        summary: "Error during AI processing of recorded audio.",
        keywords: [],
        refinedTranscript: transcription, // Or effectiveTranscription
        actionItems: [`Error: ${errorMessage}`],
        intentAnalysis: { 
          isQuestion: false, 
          isAction: false, 
          extractedQuestion: undefined, 
          extractedAction: undefined, 
          suggestedList: undefined 
        },
        aiAnswer: undefined,
        isCreativeRequest: false,
        isDirectionRequest: false,
        suggestedActionText: undefined,
        suggestedActionLink: undefined,
        aiSuggestedActionFromCreative: undefined,
        aiSuggestedListForCreativeAction: undefined,
    };
  }
}


// Pin a thought and get category suggestions
export async function pinThoughtAndSuggestCategories(
  thought: Thought
): Promise<Omit<PinnedThought, "pinnedTimestamp">> {
  try {
    const textForCategories = thought.refinedTranscript || thought.originalText;
    const categorySuggestions = await suggestCategory({ thought: textForCategories });
    return {
      ...thought,
      categories: categorySuggestions.categories,
    };
  } catch (error)
    {
    console.error("Detailed error in pinThoughtAndSuggestCategories:", error); // Enhanced logging
    return {
      ...thought,
      categories: ["Uncategorized"], // Fallback category
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
    console.error("Detailed error in clarifyThoughtWithAI:", error); // Enhanced logging
    // Consider what to return here. Throwing might be better if the caller can handle it,
    // or return a structured error response.
    const errorMessage = error instanceof Error ? error.message : "Unknown AI clarification error";
    // For now, let's match the original behavior of throwing, but with better logging.
    throw new Error(`Failed to clarify thought with AI: ${errorMessage}`);
  }
}

// New server action to directly answer a question (used by answerQuestionFlow)
// This is kept for direct calls if needed, though processTextThought now also handles question answering.
export async function answerUserQuestion(question: string): Promise<AnswerQuestionOutput> {
  try {
    const result = await answerQuestionFlow({ question });
    return result;
  } catch (error) {
    console.error("Detailed error in answerUserQuestion:", error); // Enhanced logging
    const errorMessage = error instanceof Error ? error.message : "Unknown error answering question";
    return { 
      answer: `Sorry, I encountered an error trying to answer the question: ${errorMessage}`,
      isCreativeRequest: false,
      isDirectionRequest: false,
      // Ensure all fields from AnswerQuestionOutputSchema are present
      suggestedActionText: undefined,
      suggestedActionLink: undefined,
      extractedActionFromCreative: undefined,
      suggestedListForCreativeAction: undefined,
    };
  }
}


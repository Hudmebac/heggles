
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

    // Step 1: Perform initial AI processing that can run in parallel
    const [summaryResult, keywordsResult, refinementResult] = await Promise.all([
      summarizeAudio({ transcription }),
      extractKeywords({ text: transcription }),
      refineThought({ transcript: transcription }),
    ]);
    
    // Step 2: Perform intent analysis using the refined transcript (or original if refinement fails)
    const textForIntent = refinementResult.refinedTranscript || transcription;
    const intentAnalysisResult = await analyzeThoughtIntent({ thoughtText: textForIntent });
    
    // Step 3: If it's a question, attempt to answer it
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
    console.error("Detailed error in processTextThought:", error); 
    const errorMessage = error instanceof Error ? error.message : "Unknown AI processing error";
    return {
        originalText: rawText,
        summary: "Error during AI processing.",
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

    // Step 1: Perform initial AI processing that can run in parallel
    const [summaryResult, keywordsResult, refinementResult] = await Promise.all([
        summarizeAudio({ transcription: effectiveTranscription }),
        extractKeywords({ text: effectiveTranscription }),
        refineThought({ transcript: effectiveTranscription }),
    ]);

    // Step 2: Perform intent analysis using the refined transcript (or original if refinement fails)
    const textForIntent = refinementResult.refinedTranscript || effectiveTranscription;
    const intentAnalysisResult = await analyzeThoughtIntent({ thoughtText: textForIntent });

    // Step 3: If it's a question, attempt to answer it
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
    console.error("Detailed error in processRecordedAudio:", error); 
    const errorMessage = error instanceof Error ? error.message : "Unknown AI processing error with recorded audio";
    return {
        originalText: transcription, 
        summary: "Error during AI processing of recorded audio.",
        keywords: [],
        refinedTranscript: transcription, 
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
    console.error("Detailed error in pinThoughtAndSuggestCategories:", error); 
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
    console.error("Detailed error in clarifyThoughtWithAI:", error); 
    const errorMessage = error instanceof Error ? error.message : "Unknown AI clarification error";
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
    console.error("Detailed error in answerUserQuestion:", error); 
    const errorMessage = error instanceof Error ? error.message : "Unknown error answering question";
    return { 
      answer: `Sorry, I encountered an error trying to answer the question: ${errorMessage}`,
      isCreativeRequest: false,
      isDirectionRequest: false,
      suggestedActionText: undefined,
      suggestedActionLink: undefined,
      extractedActionFromCreative: undefined,
      suggestedListForCreativeAction: undefined,
    };
  }
}


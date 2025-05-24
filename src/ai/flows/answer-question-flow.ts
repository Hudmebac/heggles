
'use server';
/**
 * @fileOverview Answers a given question using AI.
 * It can also identify creative requests, suggest Google AI Studio,
 * and if a creative request implies a task, suggest adding it to a list.
 * It can also identify direction requests and suggest Google Maps.
 * If it cannot answer, it provides alternative search links.
 *
 * - answerQuestion - Function to answer the question.
 * - AnswerQuestionInput - Input type.
 * - AnswerQuestionOutput - Output type.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {performWebSearchTool} from '@/ai/tools/search-tool';

export const AnswerQuestionInputSchema = z.object({
  question: z.string().describe('The question to be answered.'),
});
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;

export const AnswerQuestionOutputSchema = z.object({
  answer: z.string().describe('The AI-generated answer to the question or an acknowledgement if a specific tool is suggested.'),
  isCreativeRequest: z.boolean().optional().describe("True if the question is primarily a creative task (e.g., write a poem, design an app blueprint)."),
  isDirectionRequest: z.boolean().optional().describe("True if the question is primarily a request for directions or locations."),
  suggestedActionText: z.string().optional().describe("Text for a call-to-action button if a specific tool (like AI Studio or Google Maps) is suggested."),
  suggestedActionLink: z.string().optional().describe("URL for the suggested action/tool."),
  extractedActionFromCreative: z.string().optional().describe("If isCreativeRequest is true and it also implies a concrete task, this is the task description (e.g., 'Draft app blueprint')."),
  suggestedListForCreativeAction: z.enum(["todo", "shopping", "none"]).optional().describe("If extractedActionFromCreative is populated, this is the suggested list ('todo', 'shopping', or 'none')."),
  actionItems: z.array(z.object({
    title: z.string().describe("The display text for the action button/link."),
    url: z.string().url().describe("The URL for the action.")
  })).optional().describe("A list of suggested action items (e.g., search links) if the primary question cannot be answered directly."),
});

export type AnswerQuestionOutput = z.infer<typeof AnswerQuestionOutputSchema>;

export async function answerQuestion(input: AnswerQuestionInput): Promise<AnswerQuestionOutput> {
  return answerQuestionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'answerQuestionPrompt',
  input: {schema: AnswerQuestionInputSchema},
  output: {schema: AnswerQuestionOutputSchema},
  tools: [performWebSearchTool],
  prompt: `You are a knowledgeable and helpful AI assistant. Your primary goal is to analyze the user's question and provide the most appropriate response or guidance.

Question: {{{question}}}

Analyze the question based on the following categories:

1.  **Creative Request**:
    If the question is a creative task (e.g., 'write a poem about X', 'design an app blueprint for Y', 'create a plan for Z', 'generate ideas for A', 'draft a proposal for B'):
    - Set 'isCreativeRequest' to true.
    - Set 'isDirectionRequest' to false.
    - Set 'suggestedActionText' to 'Explore in Google AI Studio'.
    - Set 'suggestedActionLink' to 'https://aistudio.google.com/'.
    - Your main 'answer' field should be a brief acknowledgement, e.g., 'That sounds like a creative task! You can explore this further in Google AI Studio.'
    - **Additionally**, if this creative request also implies a concrete task that could be added to a to-do or shopping list (e.g., 'create a blueprint for an app' could also be a to-do item 'Draft app blueprint'; 'generate a list of ingredients for a cake' could be 'shopping' list items), then:
        - Populate 'extractedActionFromCreative' with the concise task description (e.g., 'Draft app blueprint', 'List ingredients for cake').
        - Populate 'suggestedListForCreativeAction' with 'todo' or 'shopping'. If it doesn't fit either, or if no clear task is implied, set it to 'none' or omit it.

2.  **Direction/Location Request**:
    If the question is about directions, locations, or navigation (e.g., 'how to get to the library?', 'best route to X', 'find nearby cafes', 'where is the Eiffel Tower?'):
    - Set 'isDirectionRequest' to true.
    - Set 'isCreativeRequest' to false.
    - Set 'suggestedActionText' to 'Open in Google Maps'.
    - Set 'suggestedActionLink' to 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent("{{{question}}}").
    - Your main 'answer' field should be a brief acknowledgement, e.g., 'For directions or location information, Google Maps can help!'.

3.  **General Question (Attempt to Answer)**:
    If it's not a clear creative or direction request, try to answer the question directly using your knowledge.
    If you need more information to answer, you may use the 'performWebSearchTool' to get current information or details you don't possess.
    - When using the web search tool:
        - Clearly indicate in your 'answer' if the search results were helpful or not (e.g., "Based on a web search...", "My search didn't yield a clear result, but...").
        - Synthesize the information from the search results to form your 'answer'.
    - If, after using your knowledge and any search results, you still cannot provide a definitive answer to the question:
        - Set the 'answer' field to a polite message indicating you couldn't find the information, e.g., "I'm sorry, I couldn't find a definitive answer to that question."
        - Populate the 'actionItems' field with an array of objects, each having a 'title' and 'url'. Include links for:
            - "Google Search" with URL "https://www.google.com/search?q=" + encodeURIComponent("{{{question}}}")
            - "Google AI Studio" with URL "https://aistudio.google.com/explore/prompt?text=" + encodeURIComponent("{{{question}}}")
            - "ChatGPT" with URL "https://chat.openai.com/?q=" + encodeURIComponent("{{{question}}}")
            - "Microsoft Copilot" with URL "https://copilot.microsoft.com/?q=" + encodeURIComponent("{{{question}}}")
        - Do NOT include markdown or text for these links in the 'answer' field; the UI will render them from 'actionItems'.
    - If you can provide a direct answer, populate the 'answer' field with it.

Only one intent (question, creative, or direction) should be primary.
- If it's a question about *how* to do something creative (e.g., "how do I write a poem?"), that's a general question, not a creative request unless it asks you *to perform* the creative task.
- If it's a question *about* a location (e.g., "What is the capital of France?"), that's a general knowledge question unless it specifically asks for directions *to* it.

Provide only the answer text and other fields as per the JSON schema.
The 'answer' field should always be populated with a direct response, an acknowledgement, or a statement about search results/inability to answer.

Ensure 'isCreativeRequest' and 'isDirectionRequest' are set appropriately (default to false if not applicable).
Ensure 'suggestedActionText' and 'suggestedActionLink' are populated ONLY if 'isCreativeRequest' or 'isDirectionRequest' is true.
If 'isCreativeRequest' is true and a task is implied, ensure 'extractedActionFromCreative' and 'suggestedListForCreativeAction' are populated.
If you cannot answer, make sure the 'answer' field indicates this and 'actionItems' are populated.
`,
});

const answerQuestionFlow = ai.defineFlow(
  {
    name: 'answerQuestionFlow',
    inputSchema: AnswerQuestionInputSchema,
    outputSchema: AnswerQuestionOutputSchema,
  },
  async (input: AnswerQuestionInput): Promise<AnswerQuestionOutput> => {
    const {output, lookup} = await prompt(input);

    // Default output structure to ensure all fields are present
    const defaultOutput: AnswerQuestionOutput = {
        answer: "I'm sorry, I encountered an issue processing your request. Please try again.",
        isCreativeRequest: false,
        isDirectionRequest: false,
        suggestedActionText: undefined,
        suggestedActionLink: undefined,
        extractedActionFromCreative: undefined,
        suggestedListForCreativeAction: undefined,
        actionItems: undefined,
    };
    
    if (!output) {
      // If LLM provides no output, return a default error response
      const encodedQuery = encodeURIComponent(input.question);
      defaultOutput.actionItems = [
        { title: "Google Search", url: `https://www.google.com/search?q=${encodedQuery}` },
        { title: "Google AI Studio", url: `https://aistudio.google.com/explore/prompt?text=${encodedQuery}` },
        { title: "ChatGPT", url: `https://chat.openai.com/?q=${encodedQuery}` },
        { title: "Microsoft Copilot", url: `https://copilot.microsoft.com/?q=${encodedQuery}` },
      ];
      return defaultOutput;
    }

    // Ensure boolean flags are always present
    const finalOutput: AnswerQuestionOutput = {
        ...defaultOutput, // Start with defaults to ensure all fields are initialized
        ...output, // Override with actual output from the LLM
        isCreativeRequest: output.isCreativeRequest ?? false,
        isDirectionRequest: output.isDirectionRequest ?? false,
    };

    // If AI says it can't answer but didn't populate actionItems, do it here as a fallback.
    const cannotAnswerPatterns = [
        /i'm sorry, i couldn't find a definitive answer/i,
        /i am unable to answer that/i,
        /my search didn't yield a clear result/i,
        /i do not have enough information/i,
        /i cannot provide an answer/i,
        /i can't answer that question/i,
        /i'm unable to find that information/i
    ];
    const aiAnswerLower = finalOutput.answer?.toLowerCase() || "";
    const aiCannotAnswer = cannotAnswerPatterns.some(pattern => pattern.test(aiAnswerLower));

    if (aiCannotAnswer && (!finalOutput.actionItems || finalOutput.actionItems.length === 0)) {
      const encodedQuery = encodeURIComponent(input.question);
      finalOutput.actionItems = [
        { title: "Google Search", url: `https://www.google.com/search?q=${encodedQuery}` },
        { title: "Google AI Studio", url: `https://aistudio.google.com/explore/prompt?text=${encodedQuery}` },
        { title: "ChatGPT", url: `https://chat.openai.com/?q=${encodedQuery}` },
        { title: "Microsoft Copilot", url: `https://copilot.microsoft.com/?q=${encodedQuery}` },
      ];
      // Conditionally add Google Maps link if it seems like a location query
      if (/directions|route|map|location of|where is/i.test(input.question.toLowerCase())) {
        finalOutput.actionItems.push({ title: "Google Maps", url: `https://www.google.com/maps/search/?api=1&query=${encodedQuery}` });
      }
    }
    
    // If it's a creative or direction request, actionItems should usually be empty.
    if (finalOutput.isCreativeRequest || finalOutput.isDirectionRequest) {
        finalOutput.actionItems = undefined;
    }

    return finalOutput;
  }
);

    
'use server';
/**
 * @fileOverview Answers a given question using AI.
 * It can also identify creative requests, suggest Google AI Studio,
 * and if a creative request implies a task, suggest adding it to a list.
 * It can also identify direction requests and suggest Google Maps.
 *
 * - answerQuestion - Function to answer the question.
 * - AnswerQuestionInput - Input type.
 * - AnswerQuestionOutput - Output type.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {performWebSearchTool} from '@/ai/tools/search-tool';

const AnswerQuestionInputSchema = z.object({
  question: z.string().describe('The question to be answered.'),
});
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;

const AnswerQuestionOutputSchema = z.object({
  answer: z.string().describe('The AI-generated answer to the question or an acknowledgement if a specific tool is suggested.'),
  isCreativeRequest: z.boolean().optional().describe("True if the question is primarily a creative task (e.g., write a poem, design an app blueprint)."),
  isDirectionRequest: z.boolean().optional().describe("True if the question is primarily a request for navigation or directions."),
  suggestedActionText: z.string().optional().describe("Text for a call-to-action button if a specific tool (like AI Studio or Google Maps) is suggested."),
  suggestedActionLink: z.string().optional().describe("URL for the suggested action/tool."),
  extractedActionFromCreative: z.string().optional().describe("If isCreativeRequest is true and it also implies a concrete task, this is the task description (e.g., 'Draft app blueprint')."),
  suggestedListForCreativeAction: z.enum(["todo", "shopping", "none"]).optional().describe("If extractedActionFromCreative is populated, this is the suggested list ('todo', 'shopping', or 'none')."),
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
    - Set 'suggestedActionText' to 'Explore in Google AI Studio'.
    - Set 'suggestedActionLink' to 'https://aistudio.google.com/'.
    - Your main 'answer' field should be a brief acknowledgement, e.g., 'That sounds like a creative task! You can explore this further in Google AI Studio.'
    - **Additionally**, if this creative request also implies a concrete task that could be added to a to-do or shopping list (e.g., 'create a blueprint for an app' could also be a to-do item 'Draft app blueprint'; 'generate a list of ingredients for a cake' could be 'shopping' list items), then:
        - Populate 'extractedActionFromCreative' with the concise task description (e.g., 'Draft app blueprint', 'List ingredients for cake').
        - Populate 'suggestedListForCreativeAction' with 'todo' or 'shopping'. If it doesn't fit either, or if no clear task is implied, set it to 'none' or omit it.
    - Do NOT set 'isAction' (from general intent analysis) to true if 'isCreativeRequest' is true.

2.  **Navigation/Direction Request**:
    If the question is primarily a request for navigation or directions (e.g., 'how do I get to the library?', 'directions to downtown from my current location', 'what's the best route to the airport?'):
    - Set 'isDirectionRequest' to true.
    - Set 'suggestedActionText' to 'Get Directions on Google Maps'.
    - For 'suggestedActionLink', try to formulate a specific Google Maps query link if possible (e.g., if the question mentions "the library", use 'https://maps.google.com/?q=directions+to+the+library'). If specific locations aren't clear or easily extractable, use a generic link: 'https://maps.google.com/'.
    - Your main 'answer' field should be a brief acknowledgement, e.g., 'I can help you find that on Google Maps.' or 'For directions, Google Maps would be best.'
    - Do NOT set 'isAction' (from general intent analysis) to true if 'isDirectionRequest' is true.

3.  **Factual Question / Other**:
    For all other types of questions:
    - First, try to answer the question directly using your own knowledge. Set 'isCreativeRequest' and 'isDirectionRequest' to false or omit them.
    - If, and only if, you determine that your internal knowledge is insufficient to provide a satisfactory answer (e.g., the question is about very recent events, specific real-time data, or obscure facts you might not know), then you MAY use the 'performWebSearchTool' to gather external information.
    - If you use the web search tool:
        - Clearly indicate in your 'answer' if the search results were helpful or not (e.g., "Based on a web search...", "My search didn't yield a clear result, but...").
        - Synthesize the information from the search results to form your 'answer'.
        - If the search results are inconclusive or do not provide an answer, state that in your 'answer' (e.g., "I'm sorry, I couldn't find a definitive answer to that question even after searching." or "My web search for that topic was not conclusive.").
    - If you cannot answer the question even after considering a web search, politely state that in your 'answer' (e.g., "I'm sorry, I couldn't find a definitive answer to that question.").

Provide only the answer text and other fields as per the JSON schema.
The 'answer' field should always be populated with a direct response, an acknowledgement, or a statement about search results/inability to answer.
Ensure 'suggestedActionText' and 'suggestedActionLink' are populated if 'isCreativeRequest' or 'isDirectionRequest' is true.
If 'isCreativeRequest' is true and a task is implied, ensure 'extractedActionFromCreative' and 'suggestedListForCreativeAction' are populated.
`,
});

const answerQuestionFlow = ai.defineFlow(
  {
    name: 'answerQuestionFlow',
    inputSchema: AnswerQuestionInputSchema,
    outputSchema: AnswerQuestionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

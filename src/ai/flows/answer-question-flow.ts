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
  suggestedActionText: z.string().optional().describe("Text for a call-to-action button if a specific tool (like AI Studio or Google Maps) is suggested."),
  suggestedActionLink: z.string().optional().describe("URL for the suggested action/tool."),
  extractedActionFromCreative: z.string().optional().describe("If isCreativeRequest is true and it also implies a concrete task, this is the task description (e.g., 'Draft app blueprint')."),
  suggestedListForCreativeAction: z.enum(["todo", "shopping", "none"]).optional().describe("If extractedActionFromCreative is populated, this is the suggested list ('todo', 'shopping', or 'none')."),
  searchOptions: z.array(z.object({ name: z.string(), url: z.string() })).optional().describe("An array of search options to display if the AI cannot provide a definitive answer."),
  actionItems: z.array(z.object({
    title: z.string(), url: z.string()
  })).optional().describe("A list of suggested action items presented as clickable buttons."),
});

type SearchToolOption = { name: string; url: string; };

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
        - Clearly indicate in your 'answer' if the search results were helpful or not (e.g., "Based on a web search...", "My search didn't yield a clear result, but...").
        - Synthesize the information from the search results to form your 'answer'.
        - If the search results are inconclusive or do not provide an answer, state that in your 'answer' (e.g., "I'm sorry, I couldn't find a definitive answer to that question even after searching." or "My web search for that topic was not conclusive.").
    - If you cannot answer the question even after considering a web search, politely state that in your 'answer' (e.g., "I'm sorry, I couldn't find a definitive answer to that question.").

Provide only the answer text and other fields as per the JSON schema.
The 'answer' field should always be populated with a direct response, an acknowledgement, or a statement about search results/inability to answer. If you cannot answer the question, state that clearly.

When you cannot answer the question, suggest alternative search options in the 'actionItems' field. These should be presented as clickable buttons labeled "Google Search", "AI Studio", "ChatGPT", and "CoPilot". The URLs for these buttons should include the user's original query.

Example 'actionItems' when you cannot answer:
"actionItems": [ { "title": "Google Search", "url": "https://www.google.com/search?q=<encoded_query>" }, { "title": "AI Studio", "url": "https://aistudio.google.com/explore/prompt?text=<encoded_query>" }, { "title": "ChatGPT", "url": "https://chat.openai.com/?q=<encoded_query>" }, { "title": "CoPilot", "url": "https://copilot.microsoft.com/?q=<encoded_query>" } ]


When you cannot answer the question:
- Set the 'answer' field to a message like "I'm sorry, I couldn't find a definitive answer to that question." Do not include the phrase "Perhaps these resources can help you find the information you need:". The UI will handle presenting the search options.

Do not include markdown formatting for the search options in the 'answer' field. The UI layer will handle the display of search options based on the AI's ability to answer.

Ensure 'suggestedActionText' and 'suggestedActionLink' are populated if 'isCreativeRequest' or 'isDirectionRequest' is true.
If 'isCreativeRequest' is true and a task is implied, ensure 'extractedActionFromCreative' and 'suggestedListForCreativeAction' are populated. If you cannot answer, make sure the 'answer' field indicates this.
`,
});

const answerQuestionFlow = ai.defineFlow(
  {
    name: 'answerQuestionFlow',
    inputSchema: AnswerQuestionInputSchema,
    outputSchema: AnswerQuestionOutputSchema,
  },
  async input => {
    const {output, lookup} = await prompt(input);
    // Define a default response object conforming to the schema
    // This will be used if the AI response is invalid or null.
    const defaultOutput: AnswerQuestionOutput = {
 answer: '',
 suggestedActionText: '',
 suggestedActionLink: undefined, // Use undefined for optional fields that are not required
 extractedActionFromCreative: '',
 suggestedListForCreativeAction: undefined, // Use undefined
 isCreativeRequest: false,
 actionItems: undefined, // Use undefined
    };

    try {
      const {output} = await prompt(input);

    // Check if the prompt explicitly stated it couldn't find a definitive answer
    // This is a heuristic based on the prompt instructions for inability to answer.
    const cannotAnswerPattern = /I'm sorry, I couldn't find a definitive answer to that question/i;
    const baseAnswer = output.answer || ''; // Use the base answer from the AI output

 const actionItems: { title: string; url: string }[] = [];

    if (cannotAnswerPattern.test(baseAnswer)) {
      // If the AI explicitly states it cannot answer, populate action items with search options
 actionItems.push({ title: 'Google Search', url: `https://www.google.com/search?q=${encodeURIComponent(input.question)}` });
 actionItems.push({ title: 'AI Studio', url: `https://aistudio.google.com/explore/prompt?text=${encodeURIComponent(input.question)}` });
 actionItems.push({ title: 'ChatGPT', url: `https://chat.openai.com/?q=${encodeURIComponent(input.question)}` });
 actionItems.push({ title: 'CoPilot', url: `https://copilot.microsoft.com/?q=${encodeURIComponent(input.question)}` });

      // Also include Google Maps for location-based queries
      // Check if the query is likely a location or direction request
      const locationKeywords = /distance|between|from|to|near|route|directions|map|address/i;
      if (locationKeywords.test(input.question)) {
 actionItems.push({ title: 'Google Maps', url: `https://www.google.com/maps/search/${encodeURIComponent(input.question)}` });
      }


      // Return the output with the search options
      return {
 answer: baseAnswer, // Use the AI's answer indicating inability to answer
 actionItems: actionItems.length > 0 ? actionItems : undefined, // Include action items if populated
 // Ensure other optional fields are strings if present, otherwise undefined
 suggestedActionText: output.suggestedActionText || undefined,
 suggestedActionLink: output.suggestedActionLink || undefined,
 extractedActionFromCreative: output.extractedActionFromCreative || undefined,
 suggestedListForCreativeAction: output.suggestedListForCreativeAction || undefined,
 isCreativeRequest: output.isCreativeRequest || false, // Ensure boolean
 };
    }

    // If AI can answer, return the answer and other relevant fields
 return {
 ...output, // Spread existing output fields
 // Ensure optional fields are strings if present, otherwise empty strings
 suggestedActionText: output.suggestedActionText || undefined,
 suggestedActionLink: output.suggestedActionLink || undefined,
 extractedActionFromCreative: output.extractedActionFromCreative || undefined,
 suggestedListForCreativeAction: output.suggestedListForCreativeAction || undefined,
 isCreativeRequest: output.isCreativeRequest || false,
 };
    } catch (error) {
 console.error('Error in answerQuestionFlow:', error);
 return {
 ...defaultOutput,
 answer: 'An error occurred while processing your question. Please try again.',
 };
    }
  }
);

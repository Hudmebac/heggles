
'use server';
/**
 * @fileOverview Answers a given question using AI.
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
  answer: z.string().describe('The AI-generated answer to the question.'),
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
  prompt: `You are a knowledgeable and helpful AI assistant. Your primary goal is to provide a concise and accurate answer to the following question based on your internal knowledge.

Question: {{{question}}}

First, try to answer the question using your own knowledge.
If, and only if, you determine that your internal knowledge is insufficient to provide a satisfactory answer (e.g., the question is about very recent events, specific real-time data, or obscure facts you might not know), then you may use the 'performWebSearchTool' to gather external information.

If you use the web search tool:
- Clearly indicate if the search results were helpful or not.
- Synthesize the information from the search results to answer the question.
- If the search results are inconclusive or do not provide an answer, state that.

If you cannot answer the question even after considering a web search, politely state that you cannot provide an answer.

Provide only the answer text.
Answer:
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

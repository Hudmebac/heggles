
'use server';
/**
 * @fileOverview Analyzes thought text to determine if it's a question or an action,
 * extracts relevant details, and suggests a list for actions.
 *
 * - analyzeThoughtIntent - Function to analyze the thought.
 * - AnalyzeThoughtIntentInput - Input type.
 * - AnalyzeThoughtIntentOutput - Output type.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeThoughtIntentInputSchema = z.object({
  thoughtText: z.string().describe('The text of the thought to analyze.'),
});
export type AnalyzeThoughtIntentInput = z.infer<typeof AnalyzeThoughtIntentInputSchema>;

const AnalyzeThoughtIntentOutputSchema = z.object({
  isQuestion: z.boolean().describe("Is the thought primarily a question?"),
  isAction: z.boolean().describe("Does the thought primarily suggest an action to be taken by the user?"),
  extractedQuestion: z.string().optional().describe("If it's a question, what is the question?"),
  extractedAction: z.string().optional().describe("If it's an action, what is the action item?"),
  suggestedList: z.enum(["todo", "shopping", "none"]).optional().describe("If it's an action, which list is most appropriate? ('todo', 'shopping', or 'none'). 'none' if the action doesn't fit a typical list (e.g., 'I should think about X'). Prioritize 'todo' for general tasks and 'shopping' for purchasing items."),
});
export type AnalyzeThoughtIntentOutput = z.infer<typeof AnalyzeThoughtIntentOutputSchema>;

export async function analyzeThoughtIntent(input: AnalyzeThoughtIntentInput): Promise<AnalyzeThoughtIntentOutput> {
  return analyzeThoughtIntentFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeThoughtIntentPrompt',
  input: {schema: AnalyzeThoughtIntentInputSchema},
  output: {schema: AnalyzeThoughtIntentOutputSchema},
  prompt: `You are an advanced text analysis AI. Your task is to analyze the given thought and determine its primary intent.
Thought: {{{thoughtText}}}

Based on the thought:
1. Is it primarily a question?
2. Does it primarily suggest an action to be taken by the user?

If it's a question, extract the question clearly. The extracted question should be suitable to be asked to another AI for an answer.
If it's an action, extract the action item clearly (e.g., "call John", "buy milk", "finish the report"). Then, suggest if this action item belongs to a 'todo' list (for general tasks, reminders, chores), a 'shopping' list (for items to purchase), or 'none' if it's an action that doesn't fit a typical list (e.g., "I should reflect on this more", "research topic X").

Only one intent (question or action) should be primary.
- If it's a question about what to do (e.g., "Should I buy milk?"), it's a question.
- If it's a statement about needing to do something (e.g., "I need to buy milk"), it's an action.
- If it's a statement of fact or an observation without a clear question or direct user action, then isQuestion and isAction should be false.

Respond with the analysis in the specified JSON format.
Ensure extractedQuestion is populated if isQuestion is true.
Ensure extractedAction and suggestedList are populated if isAction is true.
If neither a question nor a clear action is identified, set isQuestion and isAction to false, and other fields can be omitted or empty.
`,
});

const analyzeThoughtIntentFlow = ai.defineFlow(
  {
    name: 'analyzeThoughtIntentFlow',
    inputSchema: AnalyzeThoughtIntentInputSchema,
    outputSchema: AnalyzeThoughtIntentOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

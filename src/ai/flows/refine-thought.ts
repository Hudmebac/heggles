// src/ai/flows/refine-thought.ts
'use server';

/**
 * @fileOverview AI flow for refining thought transcripts by removing filler words and improving clarity.
 *
 * - refineThought - A function that refines the thought transcript.
 * - RefineThoughtInput - The input type for the refineThought function.
 * - RefineThoughtOutput - The output type for the refineThought function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const RefineThoughtInputSchema = z.object({
  transcript: z
    .string()
    .describe('The original transcript of the thought to be refined.'),
});
export type RefineThoughtInput = z.infer<typeof RefineThoughtInputSchema>;

const RefineThoughtOutputSchema = z.object({
  refinedTranscript: z
    .string()
    .describe('The refined transcript with filler words removed and improved clarity.'),
  actionItems: z.array(z.string()).describe('A list of potential action items identified in the refined transcript')
});
export type RefineThoughtOutput = z.infer<typeof RefineThoughtOutputSchema>;

export async function refineThought(input: RefineThoughtInput): Promise<RefineThoughtOutput> {
  return refineThoughtFlow(input);
}

const refineThoughtPrompt = ai.definePrompt({
  name: 'refineThoughtPrompt',
  input: {schema: RefineThoughtInputSchema},
  output: {schema: RefineThoughtOutputSchema},
  prompt: `You are an AI assistant designed to refine thought transcripts.

  Your task is to remove filler words, improve clarity, and identify potential action items.

  Original Transcript: {{{transcript}}}

  Refined Transcript:
  `,
});

const refineThoughtFlow = ai.defineFlow(
  {
    name: 'refineThoughtFlow',
    inputSchema: RefineThoughtInputSchema,
    outputSchema: RefineThoughtOutputSchema,
  },
  async input => {
    const {output} = await refineThoughtPrompt(input);
    return output!;
  }
);

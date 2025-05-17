'use server';

/**
 * @fileOverview This file defines a Genkit flow for summarizing audio transcriptions.
 *
 * - summarizeAudio - A function that accepts an audio transcription and returns a summary and keywords.
 * - SummarizeAudioInput - The input type for the summarizeAudio function.
 * - SummarizeAudioOutput - The return type for the summarizeAudio function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeAudioInputSchema = z.object({
  transcription: z
    .string()
    .describe('The audio transcription to be summarized.'),
});
export type SummarizeAudioInput = z.infer<typeof SummarizeAudioInputSchema>;

const SummarizeAudioOutputSchema = z.object({
  summary: z.string().describe('A concise summary of the audio transcription.'),
  keywords: z.array(z.string()).describe('Keywords extracted from the audio transcription.'),
});
export type SummarizeAudioOutput = z.infer<typeof SummarizeAudioOutputSchema>;

export async function summarizeAudio(input: SummarizeAudioInput): Promise<SummarizeAudioOutput> {
  return summarizeAudioFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeAudioPrompt',
  input: {schema: SummarizeAudioInputSchema},
  output: {schema: SummarizeAudioOutputSchema},
  prompt: `You are an expert AI assistant specializing in summarizing audio transcriptions and extracting key information.

  Please provide a concise summary of the following audio transcription and extract the keywords.

  Transcription: {{{transcription}}}

  Summary:
  Keywords:`, // Ensure the AI knows what to output
});

const summarizeAudioFlow = ai.defineFlow(
  {
    name: 'summarizeAudioFlow',
    inputSchema: SummarizeAudioInputSchema,
    outputSchema: SummarizeAudioOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);

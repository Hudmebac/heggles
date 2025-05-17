
// src/ai/tools/search-tool.ts
'use server';
import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const WebSearchInputSchema = z.object({
  query: z.string().describe('The search query.'),
});

const WebSearchOutputSchema = z.object({
  resultsSummary: z
    .string()
    .describe('A brief summary of the search results, or a message if no relevant results were found.'),
});

// Basic text extraction (very rudimentary)
function extractTextFromHtml(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script[^>]*>([\S\s]*?)<\/script>/gim, '');
  text = text.replace(/<style[^>]*>([\S\s]*?)<\/style>/gim, '');
  // Remove all HTML tags
  text = text.replace(/<\/?[^>]+(>|$)/g, '');
  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export const performWebSearchTool = ai.defineTool(
  {
    name: 'performWebSearchTool',
    description:
      'Performs a web search for a given query and returns a summary of the results. Use this for current events or information not typically found in static knowledge bases.',
    inputSchema: WebSearchInputSchema,
    outputSchema: WebSearchOutputSchema,
  },
  async ({query}) => {
    console.log(`Performing web search for: ${query}`);
    try {
      const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          // Some sites might block default fetch User-Agent, so a common browser UA can sometimes help
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.error(`DuckDuckGo search failed with status: ${response.status}`);
        return { resultsSummary: `Search failed with status: ${response.status}. Unable to retrieve results.` };
      }

      const html = await response.text();
      const extractedText = extractTextFromHtml(html);
      
      // For DuckDuckGo Lite, relevant results are often within the first few hundred characters after filtering.
      // This is a very naive way to get a "summary".
      const summary = extractedText.substring(0, 1000) + (extractedText.length > 1000 ? '...' : '');
      
      if (!summary.trim() || summary.toLowerCase().includes("no results found")) {
        return { resultsSummary: `No specific results found for "${query}".` };
      }

      return { resultsSummary: `Search results for "${query}": ${summary}` };
    } catch (error) {
      console.error('Error during web search:', error);
      return { resultsSummary: `An error occurred while trying to search the web for "${query}".` };
    }
  }
);

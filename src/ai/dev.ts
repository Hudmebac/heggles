import { config } from 'dotenv';
config();

import '@/ai/flows/refine-thought.ts';
import '@/ai/flows/summarize-audio.ts';
import '@/ai/flows/extract-keywords.ts';
import '@/ai/flows/suggest-category.ts';
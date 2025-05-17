
export interface Thought {
  id: string;
  timestamp: number;
  originalText: string; // Simulated transcript
  summary?: string;
  keywords?: string[];
  refinedTranscript?: string;
  actionItems?: string[];
}

export interface PinnedThought extends Thought {
  categories?: string[];
  pinnedTimestamp: number;
}

export type Theme = "light" | "dark" | "high-contrast-light" | "high-contrast-dark";

export interface ShoppingListItem {
  id: string;
  text: string;
  completed: boolean;
}

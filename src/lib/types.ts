
export interface Thought {
  id: string;
  timestamp: number;
  originalText: string; // Simulated transcript
  summary?: string;
  keywords?: string[];
  refinedTranscript?: string;
  actionItems?: string[];
  intentAnalysis?: IntentAnalysisOutput; // Added
  aiAnswer?: string; // Added
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

// ToDoListItem Related Types
export type TimeSettingType = 
  | 'not_set' 
  | 'all_day' 
  | 'am_period' 
  | 'pm_period' 
  | 'specific_start' 
  | 'specific_start_end';

export interface TimePoint {
  hh: string;
  mm: string;
  period: 'AM' | 'PM';
}

export interface ToDoListItem {
  id: string;
  text: string;
  completed: boolean;
  
  // New time structure
  timeSettingType?: TimeSettingType;
  startTime?: TimePoint | null;
  endTime?: TimePoint | null;

  // New due date field
  dueDate?: string | null; // Store as "YYYY-MM-DD"
}

export type DataFormat = 'json' | 'csv' | 'excel' | 'text';

export interface ExportImportOptions {
  format: DataFormat;
}

// Corresponds to the output of analyzeThoughtIntentFlow
export interface IntentAnalysisOutput {
  isQuestion: boolean;
  isAction: boolean;
  extractedQuestion?: string;
  extractedAction?: string;
  suggestedList?: "todo" | "shopping" | "none";
}


export interface Thought {
  id: string;
  timestamp: number;
  originalText: string; // Simulated transcript
  summary?: string;
  keywords?: string[];
  refinedTranscript?: string;
  actionItems?: string[];
  intentAnalysis?: IntentAnalysisOutput; 
  aiAnswer?: string; 
  
  // Fields for specific AI suggestions from answerQuestionFlow
  isCreativeRequest?: boolean;
  isDirectionRequest?: boolean;
  suggestedActionText?: string;
  suggestedActionLink?: string;
  aiSuggestedActionFromCreative?: string; // If creative request also implies a task
  aiSuggestedListForCreativeAction?: "todo" | "shopping" | "none"; // List for the creative-derived task
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
  
  timeSettingType?: TimeSettingType;
  startTime?: TimePoint | null;
  endTime?: TimePoint | null;

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


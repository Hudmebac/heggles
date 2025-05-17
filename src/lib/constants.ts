
// src/lib/constants.ts

export const BUFFER_TIME_OPTIONS = [
  { value: '1', label: '1 Minute' },
  { value: '5', label: '5 Minutes' },
  { value: '15', label: '15 Minutes' },
  { value: '30', label: '30 Minutes' },
  { value: 'continuous', label: 'Always On (Continuous)' },
] as const;

export type BufferTimeValue = typeof BUFFER_TIME_OPTIONS[number]['value'];

export const DEFAULT_BUFFER_TIME: BufferTimeValue = '5';

export const LOCALSTORAGE_KEYS = {
  RECALLED_THOUGHTS: 'hegsync-recalled-thoughts',
  MEMORY_VAULT: 'hegsync-memory-vault',
  BUFFER_TIME: 'hegsync-buffer-time',
  SHOPPING_LIST: 'hegsync-shopping-list',
  TODO_LIST: 'hegsync-todo-list', 
  THEME: 'hegsync-theme',
};

export const WAKE_WORDS = {
  RECALL_THOUGHT: "hegsync replay that",
  ADD_TO_SHOPPING_LIST: "hegsync add to my shopping list", // This is a full phrase prefix
  SET_BUFFER_TIME: "hegsync set buffer", // This is a prefix
  TURN_LISTENING_OFF: "hegsync turn off",
  TURN_LISTENING_ON: "hegsync turn on",
  
  // For more complex parsing of delete commands:
  DELETE_ITEM_PREFIX: "hegsync delete", // General prefix for all delete commands
  FROM_SHOPPING_LIST_TRIGGER: "from my shopping list",
  FROM_TODO_LIST_TRIGGER: "from my to do list",
  ITEM_NUMBER_KEYWORD: "item number", // Used to identify if deletion is by number
};

// Placeholder text for simulated recall based on buffer time
export const SIMULATED_RECALL_PREFIX = "This is a simulated recall from the";
export const SIMULATED_RECALL_SUFFIX = "audio buffer. Key points include discussing the upcoming project milestones, brainstorming marketing strategies for the new product launch, and remembering to schedule the team meeting for next week. Also, don't forget to pick up groceries after work and check the AI conference deadline.";

export const ACTUAL_RECORDING_SIMULATED_TRANSCRIPTION = "[Actual recorded audio snippet was processed. This is a placeholder for real Speech-to-Text output. Content would be summary of what was spoken.]";

export const RECORDING_DURATION_MS = 10000; // 10 seconds for audio snippet


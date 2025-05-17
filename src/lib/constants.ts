
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
  THEME: 'hegsync-theme',
};

export const WAKE_WORDS = {
  RECALL_THOUGHT: "hegsync replay that",
  ADD_TO_SHOPPING_LIST: "hegsync add to my shopping list",
};

export const SIMULATED_RECALL_PREFIX = "This is a simulated recall from the";
export const SIMULATED_RECALL_SUFFIX = "audio buffer. Key points include discussing the upcoming project milestones, brainstorming marketing strategies for the new product launch, and remembering to schedule the team meeting for next week. Also, don't forget to pick up groceries after work and check the AI conference deadline.";

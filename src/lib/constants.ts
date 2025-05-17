
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
  HEGGLES_BASE: "heggles", // Primary wake word

  // For UI display suffix generation in PassiveListenerControls
  HEGGLES_REPLAY_THAT: "heggles replay that",
  HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX: "heggles add", // Used by PassiveListenerControls for suffix, actual command is longer
  HEGGLES_ADD_TO_TODO_LIST_PREFIX: "heggles add",   // Used by PassiveListenerControls for suffix, actual command is longer
  HEGGLES_SET_BUFFER: "heggles set buffer",
  HEGGLES_TURN_OFF: "heggles turn off",
  HEGGLES_TURN_ON: "heggles turn on",
  DELETE_ITEM_PREFIX: "heggles delete", // Used by PassiveListenerControls for suffix

  // Full commands or critical parts for parsing in ThoughtInputForm
  // HEGGLES_REPLAY_THAT is already defined above

  // For parsing "add X to Y list" in ThoughtInputForm
  ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART: "add", // "heggles add " is the full prefix
  TO_SHOPPING_LIST_SUFFIX_REGEX_PART: "to my shopping list",
  ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART: "add", // "heggles add " is the full prefix
  TO_TODO_LIST_SUFFIX_REGEX_PART: "to my to do list",
  
  // For parsing "delete X from Y list" in ThoughtInputForm
  // DELETE_ITEM_PREFIX is already defined above
  FROM_SHOPPING_LIST_TRIGGER: "from my shopping list",
  FROM_TODO_LIST_TRIGGER: "from my to do list",
  ITEM_NUMBER_PREFIX: "item number ",

  // Dictation control
  END_DICTATION: "heggles end",
  STOP_DICTATION: "heggles stop",
};

export const RECORDING_DURATION_MS = 10000; // 10 seconds for audio snippet

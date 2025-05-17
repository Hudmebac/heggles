
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
  HEGGLES_BASE: "heggles", 
  RECALL_THOUGHT: "heggles replay that",
  ADD_TO_SHOPPING_LIST: "heggles add to my shopping list",
  ADD_TO_TODO_LIST: "heggles add to my to do list",
  SET_BUFFER_TIME: "heggles set buffer",
  TURN_LISTENING_OFF: "heggles turn off",
  TURN_LISTENING_ON: "heggles turn on",

  DELETE_ITEM_PREFIX: "heggles delete",
  FROM_SHOPPING_LIST_TRIGGER: "from my shopping list",
  FROM_TODO_LIST_TRIGGER: "from my to do list",
  ITEM_NUMBER_PREFIX: "item number ",
  END_DICTATION: "heggles end",
  STOP_DICTATION: "heggles stop",
};

export const RECORDING_DURATION_MS = 10000; // 10 seconds for audio snippet

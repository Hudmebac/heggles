
// src/lib/constants.ts

// Buffer time constants are removed as the feature is being removed.

export const LOCALSTORAGE_KEYS = {
  RECALLED_THOUGHTS: 'hegsync-recalled-thoughts',
  MEMORY_VAULT: 'hegsync-memory-vault',
  // BUFFER_TIME: 'hegsync-buffer-time', // Removed
  SHOPPING_LIST: 'hegsync-shopping-list',
  TODO_LIST: 'hegsync-todo-list',
  THEME: 'hegsync-theme', // Renamed from hegsync-theme
};

export const WAKE_WORDS = {
  HEGGLES_BASE: "heggles", // Primary wake word, kept for list additions if parsed from text

  // Dashboard specific wake words removed
  // HEGGLES_REPLAY_THAT: "heggles replay that",
  // HEGGLES_SET_BUFFER: "heggles set buffer",
  // HEGGLES_TURN_OFF: "heggles turn off",
  // HEGGLES_TURN_ON: "heggles turn on",

  // For parsing "add X to Y list" in ThoughtInputForm if text is typed/pasted
  ADD_TO_SHOPPING_LIST_FULL_PREFIX_REGEX_PART: "add",
  TO_SHOPPING_LIST_SUFFIX_REGEX_PART: "to my shopping list",
  ADD_TO_TODO_LIST_FULL_PREFIX_REGEX_PART: "add",
  TO_TODO_LIST_SUFFIX_REGEX_PART: "to my to do list",
  
  // For parsing "delete X from Y list" if text is typed/pasted
  DELETE_ITEM_PREFIX: "heggles delete",
  FROM_SHOPPING_LIST_TRIGGER: "from my shopping list",
  FROM_TODO_LIST_TRIGGER: "from my to do list",
  ITEM_NUMBER_PREFIX: "item number ",

  // Dictation control for inline mics on list pages
  END_DICTATION: "heggles end",
  STOP_DICTATION: "heggles stop",

  // Specific command phrases for parsing text input
  ADD_TO_SHOPPING_LIST_COMMAND_START: "heggles add", // Used for parsing input text
  ADD_TO_TODO_LIST_COMMAND_START: "heggles add", // Used for parsing input text
};

// RECORDING_DURATION_MS is removed as "replay that" with fixed 10s is removed.
// Continuous recording has its own start/stop.

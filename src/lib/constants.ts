
// src/lib/constants.ts

export const LOCALSTORAGE_KEYS = {
  RECALLED_THOUGHTS: 'hegsync-recalled-thoughts',
  MEMORY_VAULT: 'hegsync-memory-vault',
  SHOPPING_LIST: 'hegsync-shopping-list',
  TODO_LIST: 'hegsync-todo-list',
  THEME: 'hegsync-theme',
};

export const WAKE_WORDS = {
  // Base wake word, primarily for parsing commands from text input
  HEGGLES_BASE: "heggles",

  // For parsing "add X to Y list" in ThoughtInputForm if text is typed/pasted or from continuous recording
  ADD_TO_SHOPPING_LIST_PREFIX: "heggles add", // Full command e.g., "heggles add milk to my shopping list"
  TO_SHOPPING_LIST_SUFFIX_REGEX_PART: "to my shopping list", // For stricter matching
  ADD_TO_TODO_LIST_PREFIX: "heggles add", // Full command e.g., "heggles add call mom to my to do list"
  TO_TODO_LIST_SUFFIX_REGEX_PART: "to my to do list",

  // For parsing "delete X from Y list"
  DELETE_ITEM_PREFIX: "heggles delete",
  FROM_SHOPPING_LIST_TRIGGER: "from my shopping list",
  FROM_TODO_LIST_TRIGGER: "from my to do list",
  ITEM_NUMBER_PREFIX: "item number ",

  // Dictation control for inline mics on list pages & dashboard dictation
  END_DICTATION: "heggles end",
  STOP_DICTATION: "heggles stop",

  // New commands for Brain Button processing
  EMPTY_RECENT_THOUGHTS_COMMAND: "empty recent thoughts",
  CLEAR_SHOPPING_LIST_COMMAND: "clear shopping list",
  COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO: "tasks in to do list", // e.g. "complete all tasks in to do list"
  COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS: "to do list tasks", // e.g. "complete all to do list tasks"
  COMPLETE_ALL_TASKS_PREFIX: "complete all",
};

// For dashboard continuous recording (header mic) -> populates inputText for Brain button
// For list page inline dictation mics -> populates respective input fields

export const RECORDING_DURATION_MS = 10000; // 10 seconds for "heggles replay that" audio snippet

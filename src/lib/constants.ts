
// src/lib/constants.ts

export const LOCALSTORAGE_KEYS = {
  RECALLED_THOUGHTS: 'hegsync-recalled-thoughts',
  MEMORY_VAULT: 'hegsync-memory-vault',
  SHOPPING_LIST: 'hegsync-shopping-list',
  TODO_LIST: 'hegsync-todo-list',
  THEME: 'hegsync-theme',
};

export const WAKE_WORDS = {
  // Dashboard commands - these usually populate inputText for Brain button processing
  HEGGLES_BASE: "heggles", // Primary wake word. If spoken alone, indicates start of a command.
  HEGGLES_REPLAY_THAT: "heggles replay that", // Triggers live 10s recording when processed by Brain button

  // These are prefixes/patterns for commands that are parsed from inputText (by Brain button)
  // and usually trigger a confirmation dialog
  HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX: "heggles add",
  TO_SHOPPING_LIST_SUFFIX_REGEX_PART: "to my shopping list",

  HEGGLES_ADD_TO_TODO_LIST_PREFIX: "heggles add",
  TO_TODO_LIST_SUFFIX_REGEX_PART: "to my to do list",

  DELETE_ITEM_PREFIX: "heggles delete", // e.g., "heggles delete milk from my shopping list"
  FROM_SHOPPING_LIST_TRIGGER: "from my shopping list",
  FROM_TODO_LIST_TRIGGER: "from my to do list",
  ITEM_NUMBER_PREFIX: "item number ", // e.g., "heggles delete item number 2 from my to do list"

  // Direct action commands (voice input for these is processed immediately by ThoughtInputForm)
  HEGGLES_TURN_ON: "heggles turn on",
  HEGGLES_TURN_OFF: "heggles turn off",
  HEGGLES_SET_BUFFER: "heggles set buffer", // Followed by duration e.g., "1 minute", "always on"

  // Inline dictation control (used on Shopping/To-Do pages AND Dashboard dictation mic)
  END_DICTATION: "heggles end",
  STOP_DICTATION: "heggles stop",

  // Specific text commands (for Brain button from inputText, or AI intent matching)
  EMPTY_RECENT_THOUGHTS_COMMAND: "empty recent thoughts",
  CLEAR_SHOPPING_LIST_COMMAND: "clear shopping list",
  COMPLETE_ALL_TASKS_PREFIX: "complete all", // e.g. "complete all tasks in to do list"
  COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO: "tasks in to do list",
  COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS: "to do list tasks",
};

export const RECORDING_DURATION_MS = 10000; // 10 seconds for "replay that" live recording

// Buffer time options for "replay that" simulated buffer recall (no longer used by voice command, but kept for Settings page)
export const BUFFER_TIME_OPTIONS = [
  { value: '1', label: '1 Minute' },
  { value: '5', label: '5 Minutes' },
  { value: '15', label: '15 Minutes' },
  { value: '30', label: '30 Minutes' },
  { value: 'continuous', label: 'Always On (Continuous)' },
];
export const DEFAULT_BUFFER_TIME = '5'; // Default buffer time in minutes

export const SHARE_DEFAULTS = {
  SHOPPING_LIST_EMAIL_SUBJECT: "My Shopping List from Heggles",
  TODO_LIST_EMAIL_SUBJECT: "My To-Do List from Heggles",
  FOOTER_TEXT_PLAIN: "Thank you for using #Heggles (https://heggles.netlify.app)",
  FOOTER_TEXT_HTML: 'Thank you for using #Heggles (<a href="https://heggles.netlify.app" target="_blank" rel="noopener noreferrer">https://heggles.netlify.app</a>)',
  HEGGLES_APP_URL: "https://heggles.netlify.app", // Updated URL
};

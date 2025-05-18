
// src/lib/constants.ts

export const LOCALSTORAGE_KEYS = {
  RECALLED_THOUGHTS: 'hegsync-recalled-thoughts',
  MEMORY_VAULT: 'hegsync-memory-vault',
  SHOPPING_LIST: 'hegsync-shopping-list',
  TODO_LIST: 'hegsync-todo-list',
  THEME: 'hegsync-theme',
  // BUFFER_TIME: 'hegsync-buffer-time', // Removed as per user request
};

export const WAKE_WORDS = {
  HEGGLES_BASE: "heggles", // Primary wake word
  
  // "heggles replay that" -> This specific phrase is handled by Brain button if input contains it.
  // No longer a direct voice command for audio recording.

  // Commands to be parsed from inputText after populating via voice or typing, then processed by Brain button.
  HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX: "heggles add", 
  TO_SHOPPING_LIST_SUFFIX_REGEX_PART: "to my shopping list", 
  
  HEGGLES_ADD_TO_TODO_LIST_PREFIX: "heggles add", 
  TO_TODO_LIST_SUFFIX_REGEX_PART: "to my to do list",

  DELETE_ITEM_PREFIX: "heggles delete", // e.g., "heggles delete milk from my shopping list"
  FROM_SHOPPING_LIST_TRIGGER: "from my shopping list",
  FROM_TODO_LIST_TRIGGER: "from my to do list",
  ITEM_NUMBER_PREFIX: "item number ",

  // Inline dictation control for list pages & dashboard dictation mic
  END_DICTATION: "heggles end",
  STOP_DICTATION: "heggles stop",

  // Specific text commands processed by Brain button (and AI intent where applicable)
  EMPTY_RECENT_THOUGHTS_COMMAND: "empty recent thoughts",
  CLEAR_SHOPPING_LIST_COMMAND: "clear shopping list",
  COMPLETE_ALL_TASKS_PREFIX: "complete all",
  COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO: "tasks in to do list", 
  COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS: "to do list tasks", 
};

// Removed RECORDING_DURATION_MS as "heggles replay that" no longer uses timed recording.
// The manual dashboard mic is for dictation.

export const SHARE_DEFAULTS = {
  SHOPPING_LIST_EMAIL_SUBJECT: "My Shopping List from Heggles",
  TODO_LIST_EMAIL_SUBJECT: "My To-Do List from Heggles",
  FOOTER_TEXT_PLAIN: "Thank you for using #Heggles (https://heggie.netlify.app)",
  FOOTER_TEXT_HTML: 'Thank you for using #Heggles (<a href="https://heggie.netlify.app" target="_blank" rel="noopener noreferrer">https://heggie.netlify.app</a>)',
  HEGGLES_APP_URL: "https://heggie.netlify.app",
};

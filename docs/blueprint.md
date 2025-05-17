# **App Name**: HegSync

## Core Features:

- Passive Listening Mode: Enable passive listening mode with a clear visual indicator when active. The app maintains a local, temporary, rolling audio buffer that is continuously overwritten and not sent to the cloud unless a recall command is given.
- AI-Enhanced Transcription & Summary: Use AI to enhance transcription and summarization of captured audio.  The audio buffer is sent to Google Speech-to-Text.  The transcript is then sent to an AI model for summarization and keyword extraction.
- Instant Recall & Smart Search: Display a chronological list of retrieved thoughts (transcription + summary). Implement a search function to search through saved thought transcriptions and summaries.
- Thought Bookmarking & Memory Vault: Allow users to 'Pin' thoughts to save them permanently to a dedicated Memory Vault. AI suggests categories (e.g., 'Work Idea,' 'Personal Reminder,' 'Shopping List') based on content.
- AI Thought Clarifier: Tool to refine the content. After transcription, identify and optionally remove common filler words. AI can rephrase sentences for clarity or conciseness, as well as identify potential action items.

## Style Guidelines:

- **Light Theme:**
- Primary colour: White (#FFFFFF) for backgrounds and highlights.
- Secondary colour: Light Gray (#DDDDDD) for text and elements.
- Accent: Blue (#007BFF) for buttons and interactive elements.
- **Dark Theme:**
- Primary colour: Black (#000000) for backgrounds and highlights.
- Secondary colour: Dark Gray (#333333) for text and elements.
- Accent: Silver (#C0C0C0) for buttons and interactive elements.
- **High Contrast Light Theme:**
- Primary colour: White (#FFFFFF) for backgrounds and highlights.
- Secondary colour: Black (#000000) for text and elements.
- Accent: Bold Blue (#0000FF) for buttons and interactive elements.
- **High Contrast Dark Theme:**
- Primary colour: Black (#000000) for backgrounds and highlights.
- Secondary colour: White (#FFFFFF) for text and elements.
- Accent: Bright Yellow (#FFFF00) for buttons and interactive elements.
- All footer pages should display '© 2025 Craig Heggie. All rights reserved.' and a Button that says HeggieHub - this Button should direct user to https://heggie.netlify.app/ and the Favicon from https://heggie.netlify.app/ should be displayed next to button
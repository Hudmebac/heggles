
# Heggles - AI Thoughtstream Companion

Heggles is an intelligent tool designed to help you capture, organise, and recall your thoughts effortlessly. Leveraging the power of AI, it goes beyond simple note-taking to provide a comprehensive system for managing your internal monologue and external observations.

## Features

- **Continuous Voice Recording (Dashboard):** Use the header microphone to continuously record your thoughts. The transcript appears in the input area for processing.
- **Text Input & AI Processing:** Type directly or use the transcript from continuous recording. Click the "Brain" icon to process.
    - **AI Summarization & Keyword Extraction:** Automatically generates concise summaries and key terms.
    - **AI Intent Analysis:**
        - Detects questions and attempts to answer them.
        - Identifies actionable items and suggests adding them to your To-Do or Shopping lists (with confirmation).
- **Smart Text Commands:** Process specific commands by typing them (or getting them via continuous recording) into the input area and clicking the "Brain" icon:
    - `heggles add [item] to my shopping list`
    - `heggles add [task] to my to do list`
    - `heggles delete [item/task name or number] from my [shopping/to do] list`
    - `empty recent thoughts`
    - `clear shopping list`
    - `complete all tasks in to do list`
- **Recent Thoughts Dashboard:** View, pin, clarify, or delete recently processed thoughts.
- **Memory Vault:** A persistent archive for your pinned thoughts, searchable and categorizable.
- **Shopping List & To-Do List:** Dedicated pages to manage your lists with features like:
    - Manual and voice-dictated item entry (using inline mic buttons).
    - Completion tracking, editing, deletion.
    - To-Do list specific: due dates, time settings, sorting, and visual reminders.
    - Import/Export capabilities (CSV, JSON, Excel, Text).
    - Share lists via Email or WhatsApp (To-Do list also offers .ics calendar export).
- **Thought Clarification:** Refine thought transcripts and extract action items using AI.
- **Customizable Themes:** Light, Dark, and High-Contrast modes.
- **Data Persistence:** Utilizes browser `localStorage` to save your thoughts, lists, and preferences.

## Getting Started

To get started with Heggles:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Hudmebac/heggles.git
    cd heggles
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **Set up Environment Variables:**
    Copy the `.env.example` file to `.env` and fill in any necessary API keys (e.g., for Genkit/Google AI).
    ```bash
    cp .env.example .env
    ```
    *Note: For the current version, Genkit is configured to use Google AI (e.g., Gemini Flash) by default. Ensure your Google Cloud project is set up and authenticated for AI Platform/Vertex AI if you intend to use these models beyond any free tiers.*

4.  **Run the development server:**
    ```bash
    npm run dev
    # or
    yarn dev
    ```
    The application will typically be available at `http://localhost:9002`.

5.  **Genkit Development (Optional):**
    If you are modifying AI flows, you might need to run Genkit separately:
    ```bash
    npm run genkit:dev
    # or for watching changes
    npm run genkit:watch
    ```

## How To Use

For detailed instructions on using all features, please see the **"How To"** page within the application (accessible from the header).

## Tech Stack

- Next.js (App Router)
- React
- TypeScript
- Tailwind CSS
- ShadCN UI Components
- Lucide React Icons
- Genkit (for AI functionalities, configured with Google AI)
- `date-fns` for date utilities
- `xlsx` for Excel export/import

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

# heggles
# heggles
# heggles

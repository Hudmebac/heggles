
"use client";

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio, StopCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { processTextThought } from '@/lib/actions'; // processRecordedAudio removed as it's not used by dashboard mic anymore
import type { Thought, ShoppingListItem, ToDoListItem, BufferTimeValue } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  DEFAULT_BUFFER_TIME,
  // ACTUAL_RECORDING_SIMULATED_TRANSCRIPTION, // No longer used
  RECORDING_DURATION_MS, // No longer used by this form's direct actions
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean;
  onToggleListeningParent: (isListening: boolean) => void;
  isExternallyLongRecording: boolean; // Renamed from isLongRecording for clarity
  onStopLongRecordingParent: () => void; // To sync state if parent stops it
}

export interface ThoughtInputFormHandle {
  startLongRecording: () => boolean;
  stopLongRecordingAndProcess: () => void;
  // simulateWakeWordAndListen: () => void; // Removed as per previous refactor
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, isListening, onToggleListeningParent, isExternallyLongRecording, onStopLongRecordingParent }, ref) => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Main command listener (Heggles wake word etc.)
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);

  const [partialWakeWordDetected, setPartialWakeWordDetected] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceTranscriptRef = useRef<string>('');
  const commandProcessedSuccessfullyRef = useRef<boolean>(false);

  // Dashboard manual dictation (for the text area via dedicated mic button)
  const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
  const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
  const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dashboardDictationAccumulatedTranscriptRef = useRef<string>('');

  // Continuous "Long" Recording refs (triggered by page.tsx)
  const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
  const longRecordingTranscriptRef = useRef<string>('');
  const [isActivelyLongRecordingInternal, setIsActivelyLongRecordingInternal] = useState(false);


  // AlertDialog state
  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [alertDialogConfig, setAlertDialogConfig] = useState<{
    title: string;
    description: React.ReactNode;
    itemText?: string;
    listKey?: string;
    listName?: string;
    onConfirm: () => void;
  } | null>(null);


  useImperativeHandle(ref, () => ({
    startLongRecording: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isActivelyLongRecordingInternal) {
        toast({ title: "Cannot Start Continuous Recording", description: "System is busy, passive listening is off, or microphone permission is missing.", variant: "destructive"});
        return false;
      }
      // Stop other listeners
      commandProcessedSuccessfullyRef.current = true;
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      setIsDashboardDictationActive(false);

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        toast({ title: "Browser Not Supported", description: "Speech recognition for continuous recording not supported.", variant: "destructive" });
        return false;
      }

      const startRecordingFlow = async () => {
        try {
          if (hasMicPermission !== true) {
            // This check might be redundant if the initial guard already checks hasMicPermission === true
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(t => t.stop()); // Release immediately
            setHasMicPermission(true);
          }

          setIsActivelyLongRecordingInternal(true);
          longRecordingTranscriptRef.current = '';
          setInputText("Continuous recording active. Speak your thoughts...");

          longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
          const recognizer = longRecordingSpeechRecognizerRef.current;
          recognizer.continuous = true;
          recognizer.interimResults = true;
          recognizer.lang = 'en-US';

          recognizer.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = "";
            let finalTranscriptForThisResult = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscriptForThisResult += event.results[i][0].transcript + ' ';
              } else {
                interimTranscript += event.results[i][0].transcript;
              }
            }
            if (finalTranscriptForThisResult) {
              longRecordingTranscriptRef.current = (longRecordingTranscriptRef.current + finalTranscriptForThisResult).trim();
            }
            setInputText(longRecordingTranscriptRef.current + (interimTranscript ? (longRecordingTranscriptRef.current ? " " : "") + interimTranscript : ""));
          };

          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Continuous recording speech recognition error:", event.error, event.message);
            toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" });
            // Consider resetting state if error is fatal for this recording type
            setIsActivelyLongRecordingInternal(false);
            setInputText(longRecordingTranscriptRef.current.trim() || "Error during continuous recording."); // Keep transcript or show error
            onStopLongRecordingParent(); // Notify parent
          };
          
          recognizer.onend = () => {
            // This onend might be called if browser stops it, or if we call stop()
            // The primary stop logic is in stopLongRecordingAndProcess
            if (isActivelyLongRecordingInternal) { // If it ended unexpectedly
                setIsActivelyLongRecordingInternal(false);
                setInputText(longRecordingTranscriptRef.current.trim() || "Continuous recording ended unexpectedly.");
                onStopLongRecordingParent();
            }
          };

          recognizer.start();
          return true;
        } catch (err) {
          console.error("Error starting continuous recording:", err);
          toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsActivelyLongRecordingInternal(false);
          setInputText("");
          onStopLongRecordingParent();
          return false;
        }
      };
      startRecordingFlow();
      return true;
    },
    stopLongRecordingAndProcess: () => {
      if (!isActivelyLongRecordingInternal) return;

      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
      }
      longRecordingSpeechRecognizerRef.current = null;

      const finalTranscript = longRecordingTranscriptRef.current.trim();
      setInputText(finalTranscript); // Populate input text for Brain button processing
      longRecordingTranscriptRef.current = '';

      setIsActivelyLongRecordingInternal(false);
      // onStopLongRecordingParent(); // Parent already knows via its own state change triggering this
      toast({ title: "Recording Stopped", description: "Transcript populated in input area. Click the Brain icon to process." });
    },
  }));

  // Sync internal state if parent changes isExternallyLongRecording
   useEffect(() => {
    if (isExternallyLongRecording !== isActivelyLongRecordingInternal) {
        setIsActivelyLongRecordingInternal(isExternallyLongRecording);
        if (!isExternallyLongRecording && longRecordingSpeechRecognizerRef.current) {
            // This case should ideally be handled by parent calling stopLongRecordingAndProcess
            // but as a fallback:
            try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/* ignore */}
            setInputText(longRecordingTranscriptRef.current.trim() || "Recording stopped externally.");
        } else if (isExternallyLongRecording && !longRecordingSpeechRecognizerRef.current && ref && 'current' in ref && ref.current) {
            // If parent starts it, internal state aligns, parent should call startLongRecording
        }
    }
  }, [isExternallyLongRecording, isActivelyLongRecordingInternal, ref]);


  useEffect(() => {
    if (!isListening && isActivelyLongRecordingInternal) {
      if (ref && 'current' in ref && ref.current) {
        ref.current.stopLongRecordingAndProcess();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]); // ref dependency removed as it can cause issues

  const addListItem = (listKey: string, itemText: string, listName: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
      setIsAlertDialogOpen(false);
      setIsLoading(false);
      return;
    }
    try {
      const currentItemsString = localStorage.getItem(listKey);
      let currentItems: Array<ShoppingListItem | ToDoListItem> = currentItemsString ? JSON.parse(currentItemsString) : [];

      if (listKey === LOCALSTORAGE_KEYS.SHOPPING_LIST) {
        const newItem: ShoppingListItem = { id: crypto.randomUUID(), text: itemText.trim(), completed: false };
        currentItems = [...currentItems, newItem] as ShoppingListItem[];
      } else if (listKey === LOCALSTORAGE_KEYS.TODO_LIST) {
        const newItem: ToDoListItem = {
          id: crypto.randomUUID(),
          text: itemText.trim(),
          completed: false,
          timeSettingType: 'not_set',
          startTime: null,
          endTime: null,
          dueDate: null
        };
        currentItems = [...currentItems, newItem] as ToDoListItem[];
      }

      localStorage.setItem(listKey, JSON.stringify(currentItems));
      window.dispatchEvent(new StorageEvent('storage', { key: listKey, newValue: JSON.stringify(currentItems) }));
      toast({ title: "Item Added", description: `"${itemText.trim()}" added to your ${listName}.` });
      setInputText('');
    } catch (error) {
      console.error(`Error adding to ${listName}:`, error);
      toast({ title: `Error updating ${listName}`, description: "Could not save the item.", variant: "destructive" });
    } finally {
      setIsAlertDialogOpen(false);
      setIsLoading(false);
    }
  };

  const deleteListItem = (listKey: string, identifier: string | number, listName: string) => {
    try {
      const currentItemsString = localStorage.getItem(listKey);
      if (!currentItemsString) {
        toast({ title: "List not found", description: `The ${listName} is empty.`, variant: "default" });
        setIsLoading(false);
        return;
      }
      let currentItems: Array<ShoppingListItem | ToDoListItem> = JSON.parse(currentItemsString);
      let itemDeleted = false;
      let deletedItemText = "";

      if (typeof identifier === 'number') {
        const indexToDelete = identifier - 1;
        if (indexToDelete >= 0 && indexToDelete < currentItems.length) {
          deletedItemText = currentItems[indexToDelete].text;
          currentItems.splice(indexToDelete, 1);
          itemDeleted = true;
        } else {
          toast({ title: "Invalid Item Number", description: `Item number ${identifier} not found in ${listName}.`, variant: "default" });
        }
      } else {
        const lowerIdentifier = identifier.toLowerCase();
        const initialLength = currentItems.length;
        const itemFound = currentItems.find(item => item.text.toLowerCase() === lowerIdentifier);
        if (itemFound) deletedItemText = itemFound.text;

        currentItems = currentItems.filter(item => item.text.toLowerCase() !== lowerIdentifier);
        if (currentItems.length < initialLength) {
          itemDeleted = true;
        } else {
          toast({ title: "Item Not Found", description: `"${identifier}" not found in ${listName}.`, variant: "default" });
        }
      }

      if (itemDeleted) {
        localStorage.setItem(listKey, JSON.stringify(currentItems));
        window.dispatchEvent(new StorageEvent('storage', { key: listKey, newValue: JSON.stringify(currentItems) }));
        toast({ title: "Item Deleted", description: `"${deletedItemText}" removed from your ${listName}.` });
        setInputText('');
      }
    } catch (error) {
      console.error(`Error deleting from ${listName}:`, error);
      toast({ title: `Error updating ${listName}`, description: "Could not delete the item.", variant: "destructive" });
    } finally {
        setIsLoading(false);
    }
  };


  const handleProcessInputText = async () => {
    const textToProcess = inputText.trim();
    if (!textToProcess) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    const lowerText = textToProcess.toLowerCase();

    const shoppingListPattern = new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?shopping\\s+list$`);
    const todoListPattern = new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?to\\s*do\\s+list$`);
    const deleteListPattern = new RegExp(`^${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);

    const shoppingListMatch = lowerText.match(shoppingListPattern);
    const todoListMatch = lowerText.match(todoListPattern);
    const deleteListMatchResult = lowerText.match(deleteListPattern);


    if (shoppingListMatch && shoppingListMatch[1]) {
      const item = shoppingListMatch[1].trim();
      setAlertDialogConfig({
        title: "Add to Shopping List?",
        description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
        itemText: item,
        listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
        listName: "Shopping List",
        onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List"),
      });
      setIsAlertDialogOpen(true);
    } else if (todoListMatch && todoListMatch[1]) {
      const task = todoListMatch[1].trim();
       setAlertDialogConfig({
        title: "Add to To-Do List?",
        description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
        itemText: task,
        listKey: LOCALSTORAGE_KEYS.TODO_LIST,
        listName: "To-Do List",
        onConfirm: () => addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List"),
      });
      setIsAlertDialogOpen(true);
    } else if (deleteListMatchResult && deleteListMatchResult[1]) {
        const itemIdentifierStr = deleteListMatchResult[1].trim();
        let listKey = "";
        let listName = "";

        if (lowerText.includes(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())) {
            listKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
            listName = "Shopping List";
        } else if (lowerText.includes(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())) {
            listKey = LOCALSTORAGE_KEYS.TODO_LIST;
            listName = "To-Do List";
        }

        if (listKey && itemIdentifierStr) {
            const lowerIdentifierStr = itemIdentifierStr.toLowerCase();
            const itemNumberPrefix = WAKE_WORDS.ITEM_NUMBER_PREFIX.toLowerCase();
            if (lowerIdentifierStr.startsWith(itemNumberPrefix)) {
                const numberStr = lowerIdentifierStr.substring(itemNumberPrefix.length).trim();
                const itemNumber = parseInt(numberStr, 10);
                if (!isNaN(itemNumber) && itemNumber > 0) {
                    deleteListItem(listKey, itemNumber, listName);
                } else {
                    toast({ title: "Invalid Item Number", description: `"${numberStr}" is not a valid number.`, variant: "default" });
                    setIsLoading(false);
                }
            } else {
                deleteListItem(listKey, itemIdentifierStr, listName);
            }
        } else {
            toast({ title: "Deletion Command Incomplete", description: "Specify item and list (e.g., 'delete apples from shopping list').", variant: "default" });
            setIsLoading(false);
        }
        // Ensure input text is cleared after delete command processing
        if (!isAlertDialogOpen) setInputText('');

    } else if (lowerText === WAKE_WORDS.RECALL_THOUGHT.toLowerCase()) {
      let bufferTimeValue: BufferTimeValue = DEFAULT_BUFFER_TIME;
      if (typeof window !== 'undefined') {
        const bufferTimeValueString = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
        if (bufferTimeValueString) {
            try {
                const parsed = JSON.parse(bufferTimeValueString) as BufferTimeValue;
                if (BUFFER_TIME_OPTIONS.some(opt => opt.value === parsed)) bufferTimeValue = parsed;
            } catch (e) { console.error("Error parsing buffer time from LS:", e); }
        }
      }
      const bufferOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferTimeValue);
      const simulatedText = `Simulated recall from the ${bufferOption?.label || bufferTimeValue} buffer.`;

      try {
        // For "replay that", we directly use the simulated text.
        const processedData = await processTextThought(simulatedText);
        const newThought: Thought = { id: crypto.randomUUID(), timestamp: Date.now(), ...processedData };
        onThoughtRecalled(newThought);
        setInputText('');
        toast({ title: "Thought Processed", description: "AI processing of simulated recall complete." });
      } catch (error) {
        toast({ title: "Error Processing Simulated Recall", description: (error as Error).message, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    } else { // General text processing (could be from typed input, or voice not matching specific commands)
      try {
        const processedData = await processTextThought(textToProcess);
        let listActionTriggeredByAI = false;

        if (processedData.actionItems && processedData.actionItems.length > 0) {
          for (const action of processedData.actionItems) {
            const lowerAction = action.toLowerCase();
            // Regex to match "add '...' to ... shopping list" or "add ... to ... shopping list"
            let match = lowerAction.match(/add(?:\s+'|s\s)(.*?)(?:\s+'|\s)to\s+(?:my\s+|the\s+)?shopping\s+list/);
            if (match && match[1]) {
              const itemToAdd = match[1].trim().replace(/^['"]|['"]$/g, ''); // Remove surrounding quotes if any
              setAlertDialogConfig({
                title: "Add to Shopping List?",
                description: <>The AI suggests adding <strong>"{itemToAdd}"</strong> to your shopping list. Add it?</>,
                itemText: itemToAdd,
                listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
                listName: "Shopping List",
                onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, itemToAdd, "Shopping List"),
              });
              setIsAlertDialogOpen(true);
              listActionTriggeredByAI = true;
              break;
            }

            match = lowerAction.match(/add(?:\s+'|s\s)(.*?)(?:\s+'|\s)to\s+(?:my\s+|the\s+)?to-do\s+list/);
            if (match && match[1]) {
              const taskToAdd = match[1].trim().replace(/^['"]|['"]$/g, '');
              setAlertDialogConfig({
                title: "Add to To-Do List?",
                description: <>The AI suggests adding <strong>"{taskToAdd}"</strong> as a to-do. Add it?</>,
                itemText: taskToAdd,
                listKey: LOCALSTORAGE_KEYS.TODO_LIST,
                listName: "To-Do List",
                onConfirm: () => addListItem(LOCALSTORAGE_KEYS.TODO_LIST, taskToAdd, "To-Do List"),
              });
              setIsAlertDialogOpen(true);
              listActionTriggeredByAI = true;
              break;
            }
          }
        }

        if (!listActionTriggeredByAI) {
          const newThought: Thought = { id: crypto.randomUUID(), timestamp: Date.now(), ...processedData };
          onThoughtRecalled(newThought);
          setInputText('');
          toast({ title: "Thought Processed", description: "AI analysis complete." });
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
      } finally {
        if (!isAlertDialogOpen) { // Only set loading false if dialog isn't taking over
             setIsLoading(false);
        }
      }
    }
  };


  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    setIsBrowserUnsupported(false);

    // Stop main listener if any other mic activity is happening or if main listening is off
    if (!isListening || isLoading || isDashboardDictationActive || isActivelyLongRecordingInternal) {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Ensure clean state on stop
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
        // recognitionRef.current = null; // onend will set it to null
      }
      return; // Don't start if not listening or other activities are ongoing
    }


    if (hasMicPermission === true && recognitionRef.current === null) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
        commandProcessedSuccessfullyRef.current = false; // New session starting
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        // Preserve utterance if command wasn't fully processed (e.g. just "Heggles" and then pause/timeout)
        if (commandProcessedSuccessfullyRef.current || !partialWakeWordDetected) {
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
        }
        recognitionRef.current = null; // Allow re-initialization by useEffect
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // console.error('Main command recognition error:', event.error, event.message); // Removed the specific "no-speech" warning from here
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
        } else if (event.error === 'network') {
            toast({ title: "Network Error", variant: "destructive", description: "A network error occurred with the speech recognition service."});
        }
        // For other errors like 'no-speech', 'audio-capture', 'aborted', 'language-not-supported', 'bad-grammar', etc.
        // we let onend handle the cleanup and potential restart via useEffect.
        // Setting commandProcessedSuccessfullyRef to true ensures that if an error stops recognition,
        // the utterance is considered "done" for that attempt, preventing stale partial commands.
        commandProcessedSuccessfullyRef.current = true;
        setPartialWakeWordDetected(false); 
        utteranceTranscriptRef.current = '';
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscriptThisTurn = '';
        let newlyFinalizedSegmentThisTurn = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const segment = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            newlyFinalizedSegmentThisTurn += (newlyFinalizedSegmentThisTurn ? " " : "") + segment.trim();
          } else {
            interimTranscriptThisTurn += segment;
          }
        }

        if (newlyFinalizedSegmentThisTurn) {
            utteranceTranscriptRef.current = (utteranceTranscriptRef.current + (utteranceTranscriptRef.current ? " " : "") + newlyFinalizedSegmentThisTurn).trim();
        }
        
        const currentFullUtteranceForDisplay = (utteranceTranscriptRef.current ? utteranceTranscriptRef.current + " " : "") + interimTranscriptThisTurn.trim();
        setInputText(currentFullUtteranceForDisplay); // Always update input text with current speech

        const latestInterimForPartialCheck = interimTranscriptThisTurn.trim().toLowerCase();
        if (!partialWakeWordDetected && latestInterimForPartialCheck.includes(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
          setPartialWakeWordDetected(true);
        }
        
        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
        if (lastResultIsFinal && utteranceTranscriptRef.current) {
            const finalUtterance = utteranceTranscriptRef.current.trim();
            const finalLower = finalUtterance.toLowerCase().trim();
            let commandHandledImmediately = false;

            // 1. Handle immediate commands (turn on/off, set buffer)
            if (finalLower === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
                onToggleListeningParent(false);
                setInputText(''); // Clear input after this command
                commandHandledImmediately = true;
            } else if (finalLower === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
                onToggleListeningParent(true);
                setInputText(''); // Clear input after this command
                commandHandledImmediately = true;
            } else if (finalLower.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
                const spokenDuration = finalUtterance.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
                setBufferTimeByVoice(spokenDuration); // This also clears inputText
                commandHandledImmediately = true;
            }

            if (commandHandledImmediately) {
                commandProcessedSuccessfullyRef.current = true;
                utteranceTranscriptRef.current = '';
                setPartialWakeWordDetected(false);
            } else {
                // For all other utterances (including those starting with 'Heggles' but not immediate commands,
                // or even unrelated speech), inputText is already populated.
                // The user will click the Brain button to process it.
                // No specific "Unrelated Speech" toast from here.
                console.log(`[ThoughtInputForm] Final utterance for inputText: "${finalUtterance}" (Partial wake word: ${partialWakeWordDetected})`);
                commandProcessedSuccessfullyRef.current = true; // Consider this "finalized" for this speech recognition cycle
            }

            if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
                try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
            }
        }
      };

      try {
        // Double check conditions before starting, as state might have changed
        if (isListening && hasMicPermission === true && !isLoading && !isDashboardDictationActive && !isActivelyLongRecordingInternal && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart ) { // Ensure it's the instance we just configured
           recognitionRef.current.start();
        }
      } catch (e) {
        console.error("Failed to start main command speech recognition:", e);
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch(e2) { /* ignore */ } // Attempt to stop if it exists
            recognitionRef.current = null; // Nullify on error to allow re-init
        }
      }
    } else if (hasMicPermission === null && !isBrowserUnsupported) { // Request permission if not yet determined
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach(track => track.stop()); // Release the stream immediately after permission grant
          setHasMicPermission(true);
        })
        .catch(err => {
          console.error("Microphone permission request error:", err);
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", variant: "destructive", description:"Heggles needs microphone access for voice commands." });
        });
    }

    // Cleanup function for the useEffect
    return () => {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; // Ensure clean state on unmount/re-run
        try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
        recognitionRef.current = null;
      }
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        dashboardDictationRecognitionRef.current = null;
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      if (longRecordingSpeechRecognizerRef.current) { // Cleanup long recording if form unmounts
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isDashboardDictationActive, isActivelyLongRecordingInternal, onToggleListeningParent]); // Removed: onThoughtRecalled, toast


  const handleDashboardMicClick = async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Browser Not Supported", variant: "destructive", description: "Speech recognition for dictation not available."});
      return;
    }
    if (isActivelyLongRecordingInternal) {
      toast({ title: "Action unavailable", description: "Stop continuous recording first.", variant: "default"});
      return;
    }
    if (hasMicPermission === false) {
      toast({ title: "Microphone Access Denied", variant: "destructive"});
      return;
    }
    if (hasMicPermission === null) { // Should ideally not be hit if main useEffect runs, but as a fallback
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t=>t.stop());
        setHasMicPermission(true);
      } catch (err) {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", variant: "destructive"});
        return;
      }
    }

    if (isDashboardDictationActive) {
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        // The onend handler will call handleProcessInputText if there's text
      }
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      // No auto-submit here, user clicks Brain icon, onend handles final processing.
      return;
    }

    // Stop main command listener if it's active
    commandProcessedSuccessfullyRef.current = true;
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }

    setIsDashboardDictationActive(true);
    dashboardDictationAccumulatedTranscriptRef.current = inputText; // Start with existing text if any
    // setInputText("Listening for dictation..."); // Give visual feedback

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsRecognizingSpeech(false); // Main listener is off
      setPartialWakeWordDetected(false); // Main listener partial detection is off
      setInputText(dashboardDictationAccumulatedTranscriptRef.current || "Dictate your thought..."); // Update placeholder or existing
    };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);

      let interim = "";
      let currentFinalizedDictationSegment = ""; // Only newly finalized parts in this event

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const segment = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
           currentFinalizedDictationSegment += (currentFinalizedDictationSegment ? " " : "") + segment.trim();
        } else {
          interim += segment;
        }
      }
      if (currentFinalizedDictationSegment) {
        dashboardDictationAccumulatedTranscriptRef.current = (dashboardDictationAccumulatedTranscriptRef.current + (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + currentFinalizedDictationSegment).trim();
      }
      
      setInputText(dashboardDictationAccumulatedTranscriptRef.current + (interim ? (dashboardDictationAccumulatedTranscriptRef.current ? " " : "") + interim : ""));

      const lowerTranscriptForEndCheck = (dashboardDictationAccumulatedTranscriptRef.current + " " + interim).trim().toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
        let finalSpokenText = dashboardDictationAccumulatedTranscriptRef.current;
         if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
          const endCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(endCommand);
          if (endCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, endCmdIdx).trim();
        } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
           const stopCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(stopCommand);
           if (stopCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, stopCmdIdx).trim();
        }
        setInputText(finalSpokenText);
        dashboardDictationAccumulatedTranscriptRef.current = finalSpokenText; // Update accumulated with stripped command
        if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        // No auto-submit, user clicks Brain icon. onend might trigger if text exists.
      } else {
        dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
          // No auto-submit on pause, user clicks Brain icon
        }, 2000);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Dashboard dictation error:', event.error, event.message);
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setHasMicPermission(false);
      else if (event.error === 'no-speech' && !dashboardDictationAccumulatedTranscriptRef.current.trim()) toast({ title: "No speech detected for dictation", variant: "default" });
      else toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      
      setIsDashboardDictationActive(false);
      // dashboardDictationRecognitionRef.current = null; // onend will handle
      // Keep text in inputText for user if error occurs
    };
    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      setIsDashboardDictationActive(false);
      dashboardDictationRecognitionRef.current = null;
      
      // const finalDictatedText = dashboardDictationAccumulatedTranscriptRef.current.trim();
      // setInputText(finalDictatedText); // Ensure inputText is the final accumulated version
      // No auto-submit, user clicks Brain. The text is already in inputText.
      toast({title: "Dictation Ended", description: "Review text and click Brain icon to process."})
    };
    recognition.start();
  };

  const setBufferTimeByVoice = (spokenDuration: string) => {
    if (typeof window === 'undefined') return;
    const parsedValue = parseSpokenBufferTime(spokenDuration);
    if (parsedValue) {
      localStorage.setItem(LOCALSTORAGE_KEYS.BUFFER_TIME, JSON.stringify(parsedValue));
      window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.BUFFER_TIME, newValue: JSON.stringify(parsedValue) }));
      const matchedOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === parsedValue);
      toast({ title: "Buffer Time Set", description: <>Conceptual buffer time set to <strong>{matchedOption?.label || parsedValue}</strong>.</> });
    } else {
      toast({ title: "Buffer Time Not Understood", description: "Please try '1 minute', 'always on', etc.", variant: "default" });
    }
    setInputText(''); // Clear input text after this immediate command
    utteranceTranscriptRef.current = '';
    setPartialWakeWordDetected(false);
  };

  const parseSpokenBufferTime = (spokenDuration: string): BufferTimeValue | null => {
    const cleanedSpoken = spokenDuration.toLowerCase().trim();
    if (cleanedSpoken.includes('always on') || cleanedSpoken.includes('continuous')) return 'continuous';
    for (const option of BUFFER_TIME_OPTIONS) {
      if (option.value !== 'continuous') {
        const labelMatchValue = option.label.toLowerCase().match(/^(\d+)\s*minute/);
        if (labelMatchValue && labelMatchValue[1]) {
            const numericLabelValue = labelMatchValue[1];
            if (cleanedSpoken.startsWith(numericLabelValue) && (cleanedSpoken.includes("minute") || cleanedSpoken.includes("min"))) {
                return option.value;
            }
        }
        if (cleanedSpoken === option.value || cleanedSpoken === option.label.toLowerCase().replace(/\s*minute(s)?/, '')) return option.value;
      }
    }
    const generalMinuteMatch = cleanedSpoken.match(/^(\d+)\s*(minute|min)s?$/);
    if (generalMinuteMatch && generalMinuteMatch[1]) {
      const numericValue = generalMinuteMatch[1];
      const foundOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === numericValue);
      if (foundOption) return foundOption.value;
    }
    return null;
  };

  const getMicIconForCardHeader = () => {
    if (isActivelyLongRecordingInternal) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />;
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading) return <Mic className="h-5 w-5 text-primary" />;
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getMicStatusText = (): React.ReactNode => {
    if (isActivelyLongRecordingInternal) return "Continuous recording active...";
    if (isDashboardDictationActive) return "Dictating to input area...";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Voice Inactive (Passive Listening Off)";
    if (isBrowserUnsupported) return "Voice N/A (Browser Not Supported)";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    if (partialWakeWordDetected) return <>'<strong>Heggles</strong>' detected, awaiting command...</>;
    if (isRecognizingSpeech) return <>Say '<strong>Heggles</strong>' + command</>;
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>Heggles</strong>'</>;
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isActivelyLongRecordingInternal) return "Continuous recording active. Speech will populate here when stopped. Click Brain icon to process.";
    if (isDashboardDictationActive) return "Listening for dictation... Say 'Heggles end' or 'Heggles stop' to finish. Then click Brain icon to process.";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Enable passive listening to use voice or type input.";
    if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text will appear here. Click Brain icon to process.";
    if (isRecognizingSpeech) return "Listener active for 'Heggles'. Spoken commands will appear here. Click Brain icon to process.";
    return "Enter thought, or use voice commands to populate this area. Click Brain icon to process.";
  };

  const getDashboardDictationButtonIcon = () => {
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (!isListening || hasMicPermission !== true || isRecognizingSpeech || isActivelyLongRecordingInternal || isLoading) return <MicOff className="h-5 w-5 text-muted-foreground" />;
    return <Mic className="h-5 w-5 text-primary" />;
  };

  return (
    <>
      <Card className="w-full shadow-lg">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl">Input & Recall</CardTitle>
            {isListening && hasMicPermission !== null && !isBrowserUnsupported && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" title={typeof getMicStatusText() === 'string' ? getMicStatusText() as string : undefined}>
                {getMicIconForCardHeader()}
                <span>{getMicStatusText()}</span>
              </div>
            )}
          </div>
          <CardDescription>
             Spoken commands or typed text populate the area below. Click the <Brain className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to process.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isBrowserUnsupported && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertTitle>Browser Not Supported</AlertTitle>
              <AlertDescription>Speech recognition not supported. Manual input available.</AlertDescription>
            </Alert>
          )}
          {isListening && hasMicPermission === false && !isBrowserUnsupported && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangleIcon className="h-4 w-4" />
              <AlertTitle>Microphone Access Denied</AlertTitle>
              <AlertDescription>Voice commands require microphone access. Manual input available.</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <Textarea
              placeholder={getTextareaPlaceholder()}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={4}
              disabled={isLoading || isActivelyLongRecordingInternal}
              className="resize-none"
              aria-label="Thought input area"
            />
            <div className="flex items-stretch gap-2">
              <Button
                type="button"
                onClick={handleProcessInputText}
                disabled={isLoading || isActivelyLongRecordingInternal || !inputText.trim()}
                size="icon"
                className="p-2 h-auto"
                aria-label="Process text from input area with AI"
                title="Process text from input area with AI"
              >
                {(isLoading && !isAlertDialogOpen && inputText.trim()) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
              </Button>
              <Button
                type="button"
                onClick={handleDashboardMicClick}
                disabled={!isListening || isLoading || isActivelyLongRecordingInternal || (isRecognizingSpeech && !isDashboardDictationActive && !partialWakeWordDetected) || hasMicPermission !== true}
                size="icon"
                className="p-2 h-auto"
                aria-label="Dictate thought into text area"
                title="Dictate directly into input area (ends on pause or 'Heggles end/stop')"
              >
                {getDashboardDictationButtonIcon()}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
                The <q><strong>Heggles</strong>{WAKE_WORDS.RECALL_THOUGHT.substring(WAKE_WORDS.HEGGLES_BASE.length)}</q> voice command populates input for Brain processing.
                The <Mic className="inline-block h-3 w-3 mx-0.5 text-red-500"/> icon button (dictate) transcribes speech directly into the text area.
                The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/> / <StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (header) is for continuous recording.
                All text input (voice or typed) is processed using the <Brain className="inline-block h-3 w-3 mx-0.5"/> button.
            </p>
          </div>
        </CardContent>
      </Card>

      {alertDialogConfig && (
        <AlertDialog open={isAlertDialogOpen} onOpenChange={(open) => {
            setIsAlertDialogOpen(open);
            if (!open) {
                setIsLoading(false);
                // setInputText(''); // Don't clear on cancel, user might want to edit
            }
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{alertDialogConfig.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {alertDialogConfig.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => { setInputText(inputText); /* Keep current input */ setIsLoading(false); }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                alertDialogConfig.onConfirm();
                // setIsLoading(false); // onConfirm should handle its own isLoading
              }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";



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
import { processTextThought, processRecordedAudio } from '@/lib/actions';
import type { Thought, ShoppingListItem, ToDoListItem, BufferTimeValue } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  DEFAULT_BUFFER_TIME,
  // RECORDING_DURATION_MS, // No longer used for fixed duration recording by this component's mic button
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean;
  onToggleListeningParent: (isListening: boolean) => void;
  isExternallyLongRecording: boolean; // From page.tsx for continuous recording
  onStopLongRecordingParent: () => void; // From page.tsx
}

export interface ThoughtInputFormHandle {
  // Methods for continuous recording (controlled by page.tsx)
  startLongRecording: () => boolean;
  stopLongRecordingAndProcess: () => void;
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


  // Continuous "Long" Recording refs & state (triggered by page.tsx's button)
  const [isActivelyLongRecordingInternal, setIsActivelyLongRecordingInternal] = useState(false);
  const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
  const longRecordingTranscriptRef = useRef<string>('');
  const longRecordingAudioChunksRef = useRef<Blob[]>([]);


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

  // Imperative handle for parent (page.tsx) to control long recording
  useImperativeHandle(ref, () => ({
    startLongRecording: () => {
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isActivelyLongRecordingInternal) {
        toast({ title: "Cannot Start Continuous Recording", description: "System is busy, passive listening is off, or microphone permission is missing.", variant: "destructive"});
        return false;
      }
      // Stop other listeners
      if (recognitionRef.current) { commandProcessedSuccessfullyRef.current = true; try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      setIsRecognizingSpeech(false);
      setPartialWakeWordDetected(false);
      setIsDashboardDictationActive(false);

      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast({ title: "Browser Not Supported", description: "Audio recording or speech recognition not supported.", variant: "destructive" });
        return false;
      }
      
      const startRecordingFlow = async () => {
        try {
          if (hasMicPermission !== true) { // Re-check and request if somehow became null
            const streamPerm = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamPerm.getTracks().forEach(t => t.stop());
            setHasMicPermission(true);
          }

          setIsActivelyLongRecordingInternal(true);
          longRecordingTranscriptRef.current = '';
          longRecordingAudioChunksRef.current = [];
          setInputText("Continuous recording active. Speak your thoughts. Click Stop to populate input area.");

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
          };
          recognizer.start();

          // Start MediaRecorder for long recording
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
              longRecordingAudioChunksRef.current.push(event.data);
            }
          };
          longRecordingMediaRecorderRef.current.onstop = async () => {
            stream.getTracks().forEach(track => track.stop()); 
            // const audioBlob = new Blob(longRecordingAudioChunksRef.current, { type: 'audio/webm' });
            longRecordingAudioChunksRef.current = []; 
            // const base64AudioData = await new Promise<string>((resolve) => {
            //     const reader = new FileReader();
            //     reader.readAsDataURL(audioBlob);
            //     reader.onloadend = () => resolve(reader.result as string);
            // });
            
            // For this flow, we only care about the transcript for the input text area.
            // Audio data is conceptual or for future playback features if needed.
            setInputText(longRecordingTranscriptRef.current.trim()); 
            // User then clicks Brain icon.
          };
          longRecordingMediaRecorderRef.current.start();
          return true;

        } catch (err) {
          console.error("Error starting continuous recording:", err);
          toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsActivelyLongRecordingInternal(false);
          setInputText("");
          if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/* ignore */}}
          if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
             try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/* ignore */}
          }
          onStopLongRecordingParent();
          return false;
        }
      };
      startRecordingFlow(); // Don't need to await this here, it manages its own state
      return true;
    },
    stopLongRecordingAndProcess: () => {
      if (!isActivelyLongRecordingInternal) return;

      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
      }
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* ignore */ }
      } else {
         // If mediarecorder wasn't recording but speech was, still populate input
        setInputText(longRecordingTranscriptRef.current.trim());
      }
      
      longRecordingSpeechRecognizerRef.current = null;
      longRecordingMediaRecorderRef.current = null;

      setIsActivelyLongRecordingInternal(false);
      // Parent (page.tsx) already handles its state and toast.
      // InputText area is populated by MediaRecorder's onstop or here.
    },
  }));

  // Effect to sync internal long recording state with parent prop
   useEffect(() => {
    if (isExternallyLongRecording !== isActivelyLongRecordingInternal) {
        setIsActivelyLongRecordingInternal(isExternallyLongRecording);
        if (!isExternallyLongRecording && (longRecordingSpeechRecognizerRef.current || longRecordingMediaRecorderRef.current)) {
            if (ref && 'current' in ref && ref.current) {
              ref.current.stopLongRecordingAndProcess();
            }
        }
    }
  }, [isExternallyLongRecording, isActivelyLongRecordingInternal, ref]);


  useEffect(() => {
    if (!isListening && isActivelyLongRecordingInternal) {
      if (ref && 'current' in ref && ref.current) {
        ref.current.stopLongRecordingAndProcess();
      }
       toast({ title: "Recording Stopped", description: "Passive listening was disabled." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, isActivelyLongRecordingInternal]);


  const addListItem = (listKey: string, itemText: string, listName: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
      setIsAlertDialogOpen(false);
      // setIsLoading(false); // isLoading should be false if dialog takes over.
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
    } catch (error) {
      console.error(`Error adding to ${listName}:`, error);
      toast({ title: `Error updating ${listName}`, description: "Could not save the item.", variant: "destructive" });
    } finally {
      setIsAlertDialogOpen(false);
      setIsLoading(false); 
      setInputText(''); 
    }
  };

  const deleteListItem = (listKey: string, identifier: string | number, listName: string) => {
    try {
      const currentItemsString = localStorage.getItem(listKey);
      if (!currentItemsString) {
        toast({ title: "List not found", description: `The ${listName} is empty.`, variant: "default" });
        // setIsLoading(false); // Ensure loading is false
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
      }
    } catch (error) {
      console.error(`Error deleting from ${listName}:`, error);
      toast({ title: `Error updating ${listName}`, description: "Could not delete the item.", variant: "destructive" });
    } finally {
        // setIsLoading(false); // Ensure loading is false
        setInputText(''); 
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
    const todoListPattern = new RegExp(`^${WAKE_WORDS.ADD_TO_TODO_LIST.toLowerCase().replace(/\[task\]/, '(.+?)')}$`); // Updated regex
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
                }
            } else {
                deleteListItem(listKey, itemIdentifierStr, listName);
            }
        } else {
            toast({ title: "Deletion Command Incomplete", description: "Specify item and list (e.g., 'delete apples from shopping list').", variant: "default" });
        }
        setIsLoading(false); // Deletion is synchronous for now
    } else if (lowerText === WAKE_WORDS.RECALL_THOUGHT.toLowerCase()) {
      let bufferTimeValue: BufferTimeValue = DEFAULT_BUFFER_TIME;
      if (typeof window !== 'undefined') {
        const bufferTimeValueString = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME);
        if (bufferTimeValueString) {
            try {
                const parsed = JSON.parse(bufferTimeValueString) as BufferTimeValue;
                if (BUFFER_TIME_OPTIONS.some(opt => opt.value === parsed)) bufferTimeValue = parsed;
            } catch (e) { console.warn("Error parsing buffer time from LS:", e); }
        }
      }
      const bufferOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferTimeValue);
      const simulatedText = `Simulated recall from the ${bufferOption?.label || bufferTimeValue} buffer. This represents a thought captured from that period.`;
      setInputText(''); // Clear the "Heggles replay that" command

      try {
        // Process this simulated text as a general thought
        const processedData = await processTextThought(simulatedText);
        // Now, use the same logic as for general text to check for AI-suggested actions or questions
        let thoughtHandledByIntent = false;
        if (processedData.intentAnalysis?.isQuestion && processedData.intentAnalysis.extractedQuestion && processedData.aiAnswer) {
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Simulated Recall: Question Answered", description: "AI has provided an answer based on the simulated recall." });
            thoughtHandledByIntent = true;
        } else if (processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction && processedData.intentAnalysis.suggestedList && processedData.intentAnalysis.suggestedList !== 'none') {
            const action = processedData.intentAnalysis.extractedAction;
            const listKey = processedData.intentAnalysis.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
            const listName = processedData.intentAnalysis.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
             setAlertDialogConfig({
                title: `Simulated Recall: Suggested Action for ${listName}`,
                description: <>Based on simulated recall, the AI suggests adding "<strong>{action}</strong>" to your {listName}. Add it?</>,
                itemText: action,
                listKey: listKey,
                listName: listName,
                onConfirm: () => addListItem(listKey, action, listName),
            });
            setIsAlertDialogOpen(true); // setIsLoading(false) will be handled by addListItem or dialog close
            thoughtHandledByIntent = true;
        } else {
            // If no specific intent, just show the processed simulated recall.
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Simulated Recall Processed", description: "AI analysis of simulated recall complete." });
        }
      } catch (error) {
        toast({ title: "Error Processing Simulated Recall", description: (error as Error).message, variant: "destructive" });
      } finally {
        if (!isAlertDialogOpen) setIsLoading(false);
      }
    } else { // General text processing
      try {
        const processedData = await processTextThought(textToProcess);
        let thoughtHandled = false;

        // Priority to AI's direct intent analysis for actions/questions
        if (processedData.intentAnalysis?.isQuestion && processedData.intentAnalysis.extractedQuestion && processedData.aiAnswer) {
            onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
            toast({ title: "Thought Processed & Question Answered", description: "AI has provided an answer." });
            thoughtHandled = true;
        } else if (processedData.intentAnalysis?.isAction && processedData.intentAnalysis.extractedAction && processedData.intentAnalysis.suggestedList && processedData.intentAnalysis.suggestedList !== 'none') {
            const action = processedData.intentAnalysis.extractedAction;
            const listKey = processedData.intentAnalysis.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
            const listName = processedData.intentAnalysis.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
            setAlertDialogConfig({
                title: `Suggested Action for ${listName}`,
                description: <>The AI suggests adding "<strong>{action}</strong>" to your {listName}. Add it?</>,
                itemText: action,
                listKey: listKey,
                listName: listName,
                onConfirm: () => addListItem(listKey, action, listName),
            });
            setIsAlertDialogOpen(true); // setIsLoading(false) by addListItem or dialog close
            thoughtHandled = true;
        }
        // Fallback to actionItems from refineThought if no stronger intent was found
        else if (processedData.actionItems && processedData.actionItems.length > 0 && !thoughtHandled) {
          for (const action of processedData.actionItems) {
            const lowerAction = action.toLowerCase();
            let match = lowerAction.match(/add(?:\s+'|s\s)(.*?)(?:\s+'|\s)to\s+(?:my\s+|the\s+)?shopping\s+list/);
            if (match && match[1]) {
              const itemToAdd = match[1].trim().replace(/^['"]|['"]$/g, '');
              setAlertDialogConfig({
                title: "Add to Shopping List?",
                description: <>The AI suggests adding <strong>"{itemToAdd}"</strong> to your shopping list. Add it?</>,
                itemText: itemToAdd,
                listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
                listName: "Shopping List",
                onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, itemToAdd, "Shopping List"),
              });
              setIsAlertDialogOpen(true);
              thoughtHandled = true;
              break;
            }

            match = lowerAction.match(/add(?:\s+'|s\s)(.*?)(?:\s+'|\s)to\s+(?:my\s+|the\s+)?to-do\s+list/); // or todo list, todo-list etc.
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
              thoughtHandled = true;
              break;
            }
          }
        }

        if (!thoughtHandled) { // If no specific question or action was handled by dialogs
          onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
          toast({ title: "Thought Processed", description: "AI analysis complete." });
        }
        if (!isAlertDialogOpen) setInputText(''); // Clear input only if no dialog is open
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
      } finally {
        if (!isAlertDialogOpen) setIsLoading(false);
      }
    }
  };

  const parseSpokenBufferTime = useCallback((spokenDuration: string): BufferTimeValue | null => {
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
  }, []);

  const setBufferTimeByVoice = useCallback((spokenDuration: string) => {
    if (typeof window === 'undefined') return;
    const parsedValue = parseSpokenBufferTime(spokenDuration);
    if (parsedValue) {
      localStorage.setItem(LOCALSTORAGE_KEYS.BUFFER_TIME, JSON.stringify(parsedValue));
      window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.BUFFER_TIME, newValue: JSON.stringify(parsedValue) }));
      const matchedOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === parsedValue);
      toast({ title: "Buffer Time Set By Voice", description: <>Conceptual buffer time set to <strong>{matchedOption?.label || parsedValue}</strong>.</> });
    } else {
      toast({ title: "Buffer Time Not Understood", description: "Please try '1 minute', 'always on', etc.", variant: "default" });
    }
    setInputText('');
    utteranceTranscriptRef.current = '';
    setPartialWakeWordDetected(false);
    commandProcessedSuccessfullyRef.current = true; 
  }, [toast, parseSpokenBufferTime, setInputText, setPartialWakeWordDetected]);


  // Main command listener (Heggles wake word etc.)
  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    setIsBrowserUnsupported(false);

    const shouldBeListening = isListening &&
                              hasMicPermission === true &&
                              !isLoading && // if an AI call is in progress
                              !isDashboardDictationActive &&
                              !isActivelyLongRecordingInternal;

    if (shouldBeListening && recognitionRef.current === null) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
        commandProcessedSuccessfullyRef.current = false; // Reset for the new session
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        if (!commandProcessedSuccessfullyRef.current && partialWakeWordDetected) {
          // Paused mid-command (e.g. after "Heggles"), keep utterance for next cycle.
          // utteranceTranscriptRef.current and partialWakeWordDetected are preserved.
        } else {
          // Command was processed, or no partial detection - clear for next time.
          setPartialWakeWordDetected(false);
          utteranceTranscriptRef.current = '';
        }
        recognitionRef.current = null; // CRUCIAL for allowing useEffect to restart
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
           console.error('Main command recognition error:', event.error, event.message);
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setHasMicPermission(false);
            toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
        } else if (event.error === 'network') {
            toast({ title: "Network Error", variant: "destructive", description: "A network error occurred with the speech recognition service."});
        }
        commandProcessedSuccessfullyRef.current = true; // Consider this attempt over
        setPartialWakeWordDetected(false); 
        utteranceTranscriptRef.current = '';
        // recognitionRef.current = null; // Let onend handle this
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
        
        const latestInterimForPartialCheck = interimTranscriptThisTurn.trim().toLowerCase();
        if (!partialWakeWordDetected && latestInterimForPartialCheck.includes(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
          setPartialWakeWordDetected(true);
          utteranceTranscriptRef.current = WAKE_WORDS.HEGGLES_BASE + " "; // Start with the base word clean
        }
        
        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;

        if (lastResultIsFinal && utteranceTranscriptRef.current) {
            const finalUtterance = utteranceTranscriptRef.current.trim();
            const finalLower = finalUtterance.toLowerCase().trim();
            
            commandProcessedSuccessfullyRef.current = true; // Assume processed unless it's just "heggles"

            if (finalLower === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
                onToggleListeningParent(false);
                setInputText(''); 
            } else if (finalLower === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
                onToggleListeningParent(true);
                setInputText(''); 
            } else if (finalLower.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
                const spokenDuration = finalUtterance.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
                setBufferTimeByVoice(spokenDuration); // This already sets commandProcessedSuccessfullyRef
            } else if (finalLower === WAKE_WORDS.HEGGLES_BASE.toLowerCase()) {
                // Just "Heggles" was said and finalized. Keep listening.
                commandProcessedSuccessfullyRef.current = false; // NOT processed yet, preserve utterance.
                setInputText(finalUtterance + " "); // Show "Heggles " in input, ready for more.
                // Do not stop recognition here.
            }
             else {
                // For all other utterances, populate inputText. User clicks Brain.
                setInputText(finalUtterance);
                // Check if it was an unrecognized Heggles command
                const shoppingListPattern = new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?shopping\\s+list$`);
                const todoListPattern = new RegExp(`^${WAKE_WORDS.ADD_TO_TODO_LIST.toLowerCase().replace(/\[task\]/, '(.+?)')}$`);
                const deleteListPattern = new RegExp(`^${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);

                if (finalLower.startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase()) &&
                    !finalLower.match(shoppingListPattern) &&
                    !finalLower.match(todoListPattern) &&
                    !finalLower.match(deleteListPattern) &&
                    finalLower !== WAKE_WORDS.RECALL_THOUGHT.toLowerCase() &&
                    !finalLower.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase()) // Already handled
                   ) {
                  toast({ title: "Command Not Recognized", description: "Input area populated for manual processing.", variant: "default" });
                }
                // For other types of input (e.g. just random speech), it also populates the input text.
                // The decision to toast "Command Not Recognized" is now more specific.
            }

            // Stop recognition if the command was fully processed (or if it was just "Heggles" we DONT stop)
            if (recognitionRef.current && commandProcessedSuccessfullyRef.current) {
                try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping main command rec after result:", e); }
            }
        } else if (!lastResultIsFinal && partialWakeWordDetected) {
            // Update input text with interim results if partial wake word is detected
            setInputText(currentFullUtteranceForDisplay);
        }
      };

      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start main command speech recognition (in useEffect):", e);
        if (recognitionRef.current === recognition) { 
          recognitionRef.current = null;
        }
      }
    } else if (!shouldBeListening && recognitionRef.current) {
      commandProcessedSuccessfullyRef.current = true; 
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.warn("Error stopping main command recognition (in useEffect else):", e);
      }
       // onend will set recognitionRef.current to null
    }

    return () => {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true;
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
        recognitionRef.current = null;
      }
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        dashboardDictationRecognitionRef.current = null;
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
      if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
        try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingMediaRecorderRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isDashboardDictationActive, isActivelyLongRecordingInternal, onToggleListeningParent, setBufferTimeByVoice, toast]);


  // Effect for initial microphone permission check
  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setIsBrowserUnsupported(true);
      setHasMicPermission(false);
      return;
    }
    if (hasMicPermission === null) { // Only prompt if permission status is unknown
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach(track => track.stop()); // Release the mic immediately after permission check
          setHasMicPermission(true);
        })
        .catch(err => {
          console.warn("Microphone permission request error:", err.name, err.message);
          setHasMicPermission(false);
          // Only toast if it's a denial, not if user just closes prompt without choice on some browsers
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            toast({ title: "Microphone Access Denied", variant: "destructive", description:"Heggles needs microphone access for voice commands." });
          }
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBrowserUnsupported, hasMicPermission]); // Removed toast to avoid re-prompt issues


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
    if (hasMicPermission === null) { // Should not happen if above effect ran, but as a safeguard
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

    if (isDashboardDictationActive) { // If already dictating, stop it.
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
      }
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      // The onend handler for dashboard dictation will handle processing.
      // setInputText is already populated by onresult. User then clicks Brain.
      return;
    }

    // Stop main command listener if it's running
    if (recognitionRef.current) { 
      commandProcessedSuccessfullyRef.current = true; // Signal main listener to clean up
      try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    }
    setIsRecognizingSpeech(false); // Ensure main listener UI is off
    setPartialWakeWordDetected(false);

    setIsDashboardDictationActive(true);
    dashboardDictationAccumulatedTranscriptRef.current = ''; // Start fresh dictation
    setInputText("Dictating your thought..."); // Initial feedback

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      // setIsRecognizingSpeech(false); // Not main recognizer
      // setPartialWakeWordDetected(false);
    };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);

      let interim = "";
      let currentFinalizedDictationSegment = "";

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
      
      const currentDictationTranscript = dashboardDictationAccumulatedTranscriptRef.current;
      const textToShowInInput = currentDictationTranscript + (interim ? (currentDictationTranscript ? " " : "") + interim : "");
      setInputText(textToShowInInput);

      const lowerTranscriptForEndCheck = textToShowInInput.trim().toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
        let finalSpokenText = dashboardDictationAccumulatedTranscriptRef.current; // Use accumulated final parts
         if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
          const endCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(endCommand);
          if (endCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, endCmdIdx).trim();
        } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
           const stopCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(stopCommand);
           if (stopCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, stopCmdIdx).trim();
        }
        setInputText(finalSpokenText); // Set the cleaned text
        dashboardDictationAccumulatedTranscriptRef.current = finalSpokenText; // Store cleaned
        if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
      } else {
        dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        }, 2000); // 2-second pause
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Dashboard dictation error:', event.error, event.message);
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setHasMicPermission(false);
      else if (event.error === 'no-speech' && !dashboardDictationAccumulatedTranscriptRef.current.trim()) {
         // Don't toast if no speech and input was empty
      }
      else if (event.error === 'no-speech') {
        toast({ title: "No speech detected for dictation", variant: "default" });
      } else {
         toast({ title: "Dictation Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsDashboardDictationActive(false);
      setInputText(dashboardDictationAccumulatedTranscriptRef.current.trim()); // Keep what was transcribed before error
    };
    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      setIsDashboardDictationActive(false);
      dashboardDictationRecognitionRef.current = null;
      
      const finalDictatedText = dashboardDictationAccumulatedTranscriptRef.current.trim();
      setInputText(finalDictatedText); // Ensure inputText is the final accumulated version for Brain processing
      if (finalDictatedText) {
        toast({title: "Dictation Ended", description: "Review text and click Brain icon to process."});
      }
      // dashboardDictationAccumulatedTranscriptRef.current = ''; // Don't clear here, keep it for Brain icon
    };
    recognition.start();
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
    if (isLoading && !isAlertDialogOpen) return "Processing..."; // Only show processing if no dialog is open
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
    if (isDashboardDictationActive) return "Dictating your thought... Say 'Heggles end' or 'Heggles stop' to finish. Text will populate here for Brain processing.";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Enable passive listening to use voice or type input here.";
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
              disabled={isLoading || isActivelyLongRecordingInternal || isDashboardDictationActive}
              className="resize-none"
              aria-label="Thought input area"
            />
            <div className="flex items-stretch gap-2">
               <Button
                type="button"
                onClick={handleProcessInputText}
                disabled={isLoading || isActivelyLongRecordingInternal || isDashboardDictationActive || !inputText.trim()}
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
                The <Mic className="inline-block h-3 w-3 mx-0.5 text-primary"/> icon button (dictate) transcribes speech directly into the text area.
                The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/> / <StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (header) is for continuous recording; its transcript populates the input area when stopped.
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
                // Decide if inputText should be cleared when dialog is cancelled
                // For now, let's keep it, user might want to edit.
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
              <AlertDialogCancel onClick={() => { setIsLoading(false); /* setInputText(''); */ }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                alertDialogConfig.onConfirm();
                // setIsLoading(false) and setInputText('') are handled by addListItem or after general processing
              }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";

    
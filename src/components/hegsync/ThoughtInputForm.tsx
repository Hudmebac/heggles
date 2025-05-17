
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
import { processTextThought } from '@/lib/actions';
import type { Thought, ShoppingListItem, ToDoListItem, BufferTimeValue } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  DEFAULT_BUFFER_TIME,
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; 
  onToggleListeningParent: (isListening: boolean) => void; 
  isExternallyLongRecording: boolean;
  onStopLongRecordingParent: () => void;
}

export interface ThoughtInputFormHandle {
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
      if (!isListening || hasMicPermission !== true || isLoading || isDashboardDictationActive || isActivelyLongRecordingInternal || isExternallyLongRecording) {
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
            await navigator.mediaDevices.getUserMedia({ audio: true });
            setHasMicPermission(true);
            navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
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
          };

          recognizer.start();
          return true; 
        } catch (err) {
          console.error("Error starting continuous recording:", err);
          toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
          setIsActivelyLongRecordingInternal(false); 
          setInputText(""); 
          return false; 
        }
      };
      startRecordingFlow();
      return true;
    },
    stopLongRecordingAndProcess: () => {
      if (!isActivelyLongRecordingInternal && !isExternallyLongRecording) return; 
    
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
      }
       longRecordingSpeechRecognizerRef.current = null; 
    
      const finalTranscript = longRecordingTranscriptRef.current.trim();
      setInputText(finalTranscript); 
      longRecordingTranscriptRef.current = ''; 
    
      setIsActivelyLongRecordingInternal(false);
      onStopLongRecordingParent(); 
      // Toast is now handled by handleProcessInputText or user clicking Brain
      // toast({ title: "Recording Stopped", description: "Transcript populated in input area. Click the Brain icon to process." });
    },
  }));

  useEffect(() => {
    setIsActivelyLongRecordingInternal(isExternallyLongRecording);
  }, [isExternallyLongRecording]);

  useEffect(() => {
    if (!isListening && (isActivelyLongRecordingInternal || isExternallyLongRecording)) {
      if (ref && 'current' in ref && ref.current) {
        ref.current.stopLongRecordingAndProcess();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);


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
  
    // Pattern for adding to shopping list
    const shoppingListMatch = lowerText.match(new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?shopping\\s+list$`));
    // Pattern for adding to to-do list
    const todoListMatch = lowerText.match(new RegExp(`^${WAKE_WORDS.HEGGLES_BASE.toLowerCase()}\\s+add\\s+(.+?)\\s+to\\s+(?:my\\s+|the\\s+)?to\\s*do\\s+list$`));
    // Pattern for deleting from list
    const deleteListMatch = lowerText.match(new RegExp(`^${WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`));


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
    } else if (deleteListMatch && deleteListMatch[1]) {
        const itemIdentifierStr = deleteListMatch[1].trim();
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
    } else { // General text processing
      try {
        const processedData = await processTextThought(textToProcess);
        let listActionTriggered = false;

        if (processedData.actionItems && processedData.actionItems.length > 0) {
          for (const action of processedData.actionItems) {
            const lowerAction = action.toLowerCase();
            
            let match = lowerAction.match(/add ['"]?(.*?)['"]? to (?:my |the )?shopping list/);
            if (match && match[1]) {
              const itemToAdd = match[1];
              setAlertDialogConfig({
                title: "Add to Shopping List?",
                description: <>The AI suggests adding <strong>"{itemToAdd}"</strong> to your shopping list. Add it?</>,
                itemText: itemToAdd,
                listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
                listName: "Shopping List",
                onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, itemToAdd, "Shopping List"),
              });
              setIsAlertDialogOpen(true);
              listActionTriggered = true;
              break; 
            }

            match = lowerAction.match(/add ['"]?(.*?)['"]? to (?:my |the )?to-do list/);
            if (match && match[1]) {
              const taskToAdd = match[1];
              setAlertDialogConfig({
                title: "Add to To-Do List?",
                description: <>The AI suggests adding <strong>"{taskToAdd}"</strong> as a to-do. Add it?</>,
                itemText: taskToAdd,
                listKey: LOCALSTORAGE_KEYS.TODO_LIST,
                listName: "To-Do List",
                onConfirm: () => addListItem(LOCALSTORAGE_KEYS.TODO_LIST, taskToAdd, "To-Do List"),
              });
              setIsAlertDialogOpen(true);
              listActionTriggered = true;
              break;
            }
          }
        }

        if (!listActionTriggered) {
          const newThought: Thought = { id: crypto.randomUUID(), timestamp: Date.now(), ...processedData };
          onThoughtRecalled(newThought); 
          setInputText('');
          toast({ title: "Thought Processed", description: "AI analysis complete." });
        }
      } catch (error) {
        toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
      } finally {
        if (!isAlertDialogOpen) { 
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

    if (!isListening || hasMicPermission === false || isLoading || isDashboardDictationActive || isActivelyLongRecordingInternal || isExternallyLongRecording) {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; 
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
      return;
    }

    if (hasMicPermission === true && recognitionRef.current === null) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;
      recognition.continuous = true; 
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
        commandProcessedSuccessfullyRef.current = false; 
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        if (commandProcessedSuccessfullyRef.current || !partialWakeWordDetected) {
            setPartialWakeWordDetected(false);
            utteranceTranscriptRef.current = '';
        }
        // If it ended and we were expecting more (e.g., after just "Heggles"), 
        // and a command wasn't processed, input text might need to be populated if not already by interim.
        // This is now handled by setting inputText on every final result.
        recognitionRef.current = null; 
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
         if (event.error === 'no-speech' || event.error === 'aborted') {
            // console.warn('Main command recognition warning:', event.error, event.message || "(No specific message)");
         } else {
           console.error('Main command recognition error:', event.error, event.message || "(No specific message)");
         }
        commandProcessedSuccessfullyRef.current = true; 
        setPartialWakeWordDetected(false); 
        utteranceTranscriptRef.current = ''; // Clear utterance on error

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", variant: "destructive", description: "A network error occurred with the speech recognition service."});
        }
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscriptThisTurn = '';
        let finalizedSegmentThisTurn = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const segment = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalizedSegmentThisTurn += (finalizedSegmentThisTurn ? " " : "") + segment.trim();
          } else {
            interimTranscriptThisTurn += segment;
          }
        }
        
        if (finalizedSegmentThisTurn) {
            utteranceTranscriptRef.current = (utteranceTranscriptRef.current + (utteranceTranscriptRef.current ? " " : "") + finalizedSegmentThisTurn).trim();
        }
        
        const latestInterimForPartialCheck = interimTranscriptThisTurn.trim().toLowerCase();
        if (!partialWakeWordDetected && latestInterimForPartialCheck.includes(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
          setPartialWakeWordDetected(true);
        }
        
        setInputText((utteranceTranscriptRef.current ? utteranceTranscriptRef.current + " " : "") + interimTranscriptThisTurn.trim());

        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
        if (lastResultIsFinal && utteranceTranscriptRef.current) {
          const finalUtterance = utteranceTranscriptRef.current.trim(); 
          const finalLower = finalUtterance.toLowerCase().trim();
          
          commandProcessedSuccessfullyRef.current = true; // Assume processed unless it's just "Heggles"

          if (finalLower === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
            onToggleListeningParent(false);
            setInputText(''); 
            utteranceTranscriptRef.current = ''; 
            setPartialWakeWordDetected(false);
          } else if (finalLower === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
            onToggleListeningParent(true);
            setInputText('');
            utteranceTranscriptRef.current = '';
            setPartialWakeWordDetected(false);
          } else if (finalLower.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
            const spokenDuration = finalUtterance.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
            setBufferTimeByVoice(spokenDuration);
            // Don't clear inputText, let user decide if they want to process it, or it will be cleared by Brain button.
            utteranceTranscriptRef.current = '';
            setPartialWakeWordDetected(false);
          } else if (finalLower === WAKE_WORDS.HEGGLES_BASE.toLowerCase()) {
            commandProcessedSuccessfullyRef.current = false; // Not fully processed, expecting more
            toast({ title: <><strong>Heggles</strong> Activated</>, description: "Awaiting your full command..." });
            // Don't stop recognition
          } else if (finalLower.startsWith(WAKE_WORDS.HEGGLES_BASE.toLowerCase())) {
            // Any other "Heggles..." command gets populated for Brain button processing
            toast({ title: "Command Captured", description: "Review in input area and click the Brain icon to process." });
             // Don't clear utteranceTranscriptRef or partialWakeWordDetected yet, onend will handle if recognition stops
          } else {
            // Speech not starting with Heggles - this branch might not be hit often if continuous listening is well-behaved
            // or if the browser filters out non-wake-word speech earlier.
            // If it does, treat as unhandled.
            toast({ title: "Unrelated Speech Detected", description: "Ignored. Say 'Heggles' followed by your command." });
            setInputText(''); 
            utteranceTranscriptRef.current = '';
            setPartialWakeWordDetected(false);
          }

          // Stop recognition only if a command was fully processed OR it was unrelated speech.
          // If it was just "Heggles", keep listening.
          if (recognitionRef.current && commandProcessedSuccessfullyRef.current) { 
            try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
          }
        }
      };

      try {
        if (isListening && hasMicPermission === true && !isLoading && !isDashboardDictationActive && !isActivelyLongRecordingInternal && !isExternallyLongRecording && recognitionRef.current && recognitionRef.current.onstart === recognition.onstart ) {
           recognition.start();
        }
      } catch (e) {
        console.error("Failed to start main command speech recognition:", e);
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch(e2) { /* ignore */ }
            recognitionRef.current = null; 
        }
      }
    } else if (hasMicPermission === null && !isBrowserUnsupported) {
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach(track => track.stop()); 
          setHasMicPermission(true);
        })
        .catch(err => {
          console.error("Microphone permission request error:", err);
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", variant: "destructive" });
        });
    }

    return () => {
      if (recognitionRef.current) {
        commandProcessedSuccessfullyRef.current = true; 
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
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, hasMicPermission, isLoading, isDashboardDictationActive, isActivelyLongRecordingInternal, isExternallyLongRecording, onToggleListeningParent]);


  const handleDashboardMicClick = async () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      toast({ title: "Browser Not Supported", variant: "destructive"});
      return;
    }
    if (isExternallyLongRecording || isActivelyLongRecordingInternal) {
      toast({ title: "Action unavailable", description: "Stop continuous recording first.", variant: "default"});
      return;
    }
    if (hasMicPermission === false) {
      toast({ title: "Microphone Access Denied", variant: "destructive"});
      return;
    }
    if (hasMicPermission === null) {
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
      }
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      // No auto-submit here, user clicks Brain icon
      return; 
    }

    commandProcessedSuccessfullyRef.current = true; 
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    
    setIsDashboardDictationActive(true);
    dashboardDictationAccumulatedTranscriptRef.current = inputText; // Start with existing text
    // setInputText(''); // Don't clear inputText, append to it.

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true; 
    recognition.interimResults = true; 
    recognition.lang = 'en-US';

    recognition.onstart = () => { setIsRecognizingSpeech(false); setPartialWakeWordDetected(false);}; // Main listener is off
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      
      let interim = "";
      let currentDictationTranscript = dashboardDictationAccumulatedTranscriptRef.current; 

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const segment = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
           currentDictationTranscript = (currentDictationTranscript + (currentDictationTranscript ? " " : "") + segment).trim();
        } else {
          interim += segment;
        }
      }
      dashboardDictationAccumulatedTranscriptRef.current = currentDictationTranscript;
      setInputText(currentDictationTranscript + (interim ? (currentDictationTranscript ? " " : "") + interim : ""));

      const lowerTranscriptForEndCheck = (currentDictationTranscript + " " + interim).trim().toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscriptForEndCheck.endsWith(endCommand) || lowerTranscriptForEndCheck.endsWith(stopCommand)) {
        let finalSpokenText = currentDictationTranscript; 
         if (lowerTranscriptForEndCheck.endsWith(endCommand)) {
          const endCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(endCommand);
          if (endCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, endCmdIdx).trim();
        } else if (lowerTranscriptForEndCheck.endsWith(stopCommand)) {
           const stopCmdIdx = finalSpokenText.toLowerCase().lastIndexOf(stopCommand);
           if (stopCmdIdx !== -1) finalSpokenText = finalSpokenText.substring(0, stopCmdIdx).trim();
        }
        setInputText(finalSpokenText); 
        if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        // No auto-submit, user clicks Brain icon
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
      else if (event.error === 'no-speech' && !inputText.trim()) toast({ title: "No speech detected", variant: "default" });
      else toast({ title: "Dictation Error", variant: "destructive" });
      setIsDashboardDictationActive(false);
      dashboardDictationRecognitionRef.current = null;
      // dashboardDictationAccumulatedTranscriptRef.current = ''; // Keep text for user
    };
    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      setIsDashboardDictationActive(false);
      dashboardDictationRecognitionRef.current = null; 
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
    setInputText(''); // Clear after processing this command
    utteranceTranscriptRef.current = '';
    setPartialWakeWordDetected(false);
  };
  
  const parseSpokenBufferTime = (spokenDuration: string): BufferTimeValue | null => {
    const cleanedSpoken = spokenDuration.toLowerCase().trim();
    if (cleanedSpoken.includes('always on') || cleanedSpoken.includes('continuous')) return 'continuous';
    for (const option of BUFFER_TIME_OPTIONS) {
      if (option.value !== 'continuous') {
        // Try to match "X minute(s)"
        const labelMatchValue = option.label.toLowerCase().match(/^(\d+)\s*minute/);
        if (labelMatchValue && labelMatchValue[1]) {
            const numericLabelValue = labelMatchValue[1];
            if (cleanedSpoken.startsWith(numericLabelValue) && (cleanedSpoken.includes("minute") || cleanedSpoken.includes("min"))) {
                return option.value;
            }
        }
        // Fallback for direct value match (e.g., "1", "5")
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
    if (isActivelyLongRecordingInternal || isExternallyLongRecording) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />; 
    if (partialWakeWordDetected) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />; 
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading) return <Mic className="h-5 w-5 text-primary" />; 
    return <MicOff className="h-5 w-5 text-muted-foreground" />;
  };

  const getMicStatusText = (): React.ReactNode => {
    if (isActivelyLongRecordingInternal || isExternallyLongRecording) return "Continuous recording active...";
    if (isDashboardDictationActive) return "Dictating to input area...";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Voice Inactive";
    if (isBrowserUnsupported) return "Voice N/A";
    if (hasMicPermission === false) return "Mic Denied";
    if (hasMicPermission === null) return "Mic Awaiting Permission...";
    if (partialWakeWordDetected) return <>'<strong>Heggles</strong>' detected, awaiting command...</>;
    if (isRecognizingSpeech) return <>Say '<strong>Heggles</strong>' + command</>;
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>Heggles</strong>'</>;
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isActivelyLongRecordingInternal || isExternallyLongRecording) return "Continuous recording active. Speech will populate here when stopped. Click Brain icon to process.";
    if (isDashboardDictationActive) return "Listening for dictation... Say 'Heggles end' or 'Heggles stop' to finish. Then click Brain icon to process.";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Enable passive listening to use voice or type input.";
    if (partialWakeWordDetected) return "'Heggles' detected. Finish your command. Text will appear here. Click Brain icon to process.";
    if (isRecognizingSpeech) return "Listener active for 'Heggles'. Spoken commands will appear here. Click Brain icon to process.";
    return "Enter thought, or use voice commands to populate this area. Click Brain icon to process.";
  };
  
  const getDashboardDictationButtonIcon = () => { 
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />;
    if (!isListening || hasMicPermission !== true || isRecognizingSpeech || isActivelyLongRecordingInternal || isExternallyLongRecording || isLoading) return <MicOff className="h-5 w-5 text-muted-foreground" />;
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
              disabled={isLoading || (isActivelyLongRecordingInternal || isExternallyLongRecording)}
              className="resize-none"
              aria-label="Thought input area"
            />
            <div className="flex items-stretch gap-2">
              <Button
                type="button" 
                onClick={handleProcessInputText}
                disabled={isLoading || (isActivelyLongRecordingInternal || isExternallyLongRecording) || !inputText.trim()}
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
                disabled={!isListening || isLoading || (isActivelyLongRecordingInternal || isExternallyLongRecording) || (isRecognizingSpeech && !isDashboardDictationActive && !partialWakeWordDetected) || hasMicPermission !== true}
                size="icon"
                className="p-2 h-auto"
                aria-label="Dictate thought into text area"
                title="Dictate directly into input area (ends on pause or 'Heggles end/stop')"
              >
                {getDashboardDictationButtonIcon()}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
                The <q><strong>Heggles</strong>{WAKE_WORDS.RECALL_THOUGHT.substring(WAKE_WORDS.HEGGLES_BASE.length)}</q> voice command (if spoken) populates input for Brain processing.
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
                // setInputText(''); // Don't clear input text on cancel, user might want to edit it
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
              <AlertDialogCancel onClick={() => { /* State handled by onOpenChange */ }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => {
                alertDialogConfig.onConfirm();
              }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
});

ThoughtInputForm.displayName = "ThoughtInputForm";

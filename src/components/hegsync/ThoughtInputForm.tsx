
"use client";

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon, Radio, StopCircle, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { processTextThought } from '@/lib/actions'; // processRecordedAudio removed as its flow changed
import type { Thought, ShoppingListItem, ToDoListItem, BufferTimeValue } from '@/lib/types';
import {
  WAKE_WORDS,
  LOCALSTORAGE_KEYS,
  BUFFER_TIME_OPTIONS,
  DEFAULT_BUFFER_TIME,
  // RECORDING_DURATION_MS, // No longer used here for fixed duration
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; // Main passive listening toggle from parent
  onToggleListeningParent: (isListening: boolean) => void; // To control parent's listening state
  isExternallyLongRecording: boolean;
  onStopLongRecordingParent: () => void;
}

export interface ThoughtInputFormHandle {
  // simulateWakeWordAndListen: () => void; // Removed as per new flow
  startLongRecording: () => boolean;
  stopLongRecordingAndProcess: () => void;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, isListening, onToggleListeningParent, isExternallyLongRecording, onStopLongRecordingParent }, ref) => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // Main command listener (HegSync wake word etc.)
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false); // For main wake word listener
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  
  const partialWakeWordDetectedRef = useRef<boolean>(false); // Using ref to avoid re-renders for this internal state
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const utteranceTranscriptRef = useRef<string>(''); // Accumulates full transcript for current utterance
  const commandProcessedSuccessfullyRef = useRef<boolean>(false); // Helps onend decide if transcript should be cleared

  // Dashboard manual dictation (for the text area via dedicated mic button)
  const [isDashboardDictationActive, setIsDashboardDictationActive] = useState(false);
  const dashboardDictationRecognitionRef = useRef<SpeechRecognition | null>(null);
  const dashboardDictationPauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dashboardDictationAccumulatedTranscriptRef = useRef<string>('');


  // Continuous "Long" Recording refs (triggered by page.tsx)
  const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null); // Still needed for audio blob if desired for other uses
  const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
  const longRecordingTranscriptRef = useRef<string>('');
  // const longRecordingAudioChunksRef = useRef<Blob[]>([]); // Retained if audio blob is useful later
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
      commandProcessedSuccessfullyRef.current = true; // Signal other listeners to fully stop and clear
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      if (dashboardDictationRecognitionRef.current) { try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/} }
      setIsRecognizingSpeech(false);
      partialWakeWordDetectedRef.current = false;
      setIsDashboardDictationActive(false);
      
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        toast({ title: "Browser Not Supported", description: "Speech recognition for continuous recording not supported.", variant: "destructive" });
        return false;
      }

      const startRecordingFlow = async () => {
        try {
          // Ensure mic permission one last time if needed (though hasMicPermission check above should cover it)
          if (hasMicPermission !== true) {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            setHasMicPermission(true); // Should already be true, but defensive
             // Release stream immediately after permission check if not using MediaRecorder
            navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
          }

          setIsActivelyLongRecordingInternal(true); 
          longRecordingTranscriptRef.current = '';
          setInputText("Continuous recording active. Speak your thoughts..."); 

          // MediaRecorder setup (optional if only transcript is needed, but kept for potential future audio use)
          // const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // longRecordingAudioChunksRef.current = [];
          // longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
          // longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
          //   if (event.data.size > 0) longRecordingAudioChunksRef.current.push(event.data);
          // };
          // longRecordingMediaRecorderRef.current.start();


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
            // Update inputText live with the accumulating transcript
            setInputText(longRecordingTranscriptRef.current + (interimTranscript ? (longRecordingTranscriptRef.current ? " " : "") + interimTranscript : ""));
          };
          
          recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error("Continuous recording speech recognition error:", event.error, event.message);
            toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" });
            // Consider stopping MediaRecorder here too if speech rec fails critically
          };

          recognizer.onend = () => {
            // This onend might fire if speech stops for a while, but MediaRecorder is still going.
            // The main stop logic is in stopLongRecordingAndProcess
             // If recognizer stops but MediaRecorder is active, maybe restart recognizer?
            // For now, rely on explicit stop.
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
      if (!isActivelyLongRecordingInternal && !isExternallyLongRecording) return; // Check internal state too
    
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
        // onend of longRecordingSpeechRecognizerRef will set it to null implicitly if it was running
      }
       longRecordingSpeechRecognizerRef.current = null; // Ensure it's cleared
    
      // if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
      //   longRecordingMediaRecorderRef.current.onstop = () => {
      //     // const audioBlob = new Blob(longRecordingAudioChunksRef.current, { type: 'audio/webm' });
      //     // longRecordingAudioChunksRef.current = []; 
          
          const finalTranscript = longRecordingTranscriptRef.current.trim();
          setInputText(finalTranscript); // Populate input text for manual Brain processing
          longRecordingTranscriptRef.current = ''; // Clear for next time
    
          setIsActivelyLongRecordingInternal(false);
          onStopLongRecordingParent(); // Sync with parent
          // if (longRecordingMediaRecorderRef.current?.stream) {
          //   longRecordingMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
          // }
          // longRecordingMediaRecorderRef.current = null;
          toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
      //   };
      //   try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { /* ignore */ }
      // } else {
      //    // If MediaRecorder wasn't running or already stopped, just use the transcript
      //    const finalTranscript = longRecordingTranscriptRef.current.trim();
      //    setInputText(finalTranscript);
      //    longRecordingTranscriptRef.current = '';
      //    setIsActivelyLongRecordingInternal(false);
      //    onStopLongRecordingParent();
      //    toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
      // }
    },
  }));

  useEffect(() => {
    setIsActivelyLongRecordingInternal(isExternallyLongRecording);
  }, [isExternallyLongRecording]);

  useEffect(() => {
    if (!isListening && (isActivelyLongRecordingInternal || isExternallyLongRecording)) {
      if (ref && 'current' in ref && ref.current) {
        ref.current.stopLongRecordingAndProcess();
         // Toast is handled in stopLongRecordingAndProcess
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);


  const addListItem = (listKey: string, itemText: string, listName: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
      setIsAlertDialogOpen(false);
      setIsLoading(false); // Ensure loading is reset
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
  
    // Direct command matching first
    if (lowerText.startsWith(WAKE_WORDS.ADD_TO_SHOPPING_LIST.toLowerCase())) {
      const item = textToProcess.substring(WAKE_WORDS.ADD_TO_SHOPPING_LIST.length).trim();
      if (item) {
        setAlertDialogConfig({
          title: "Add to Shopping List?",
          description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
          itemText: item,
          listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
          listName: "Shopping List",
          onConfirm: () => addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List"),
        });
        setIsAlertDialogOpen(true);
      } else {
        toast({ title: "No item specified", description: "Please specify an item for the shopping list.", variant: "default" });
        setIsLoading(false);
      }
    } else if (lowerText.startsWith(WAKE_WORDS.ADD_TO_TODO_LIST.toLowerCase())) {
      const task = textToProcess.substring(WAKE_WORDS.ADD_TO_TODO_LIST.length).trim();
      if (task) {
         setAlertDialogConfig({
          title: "Add to To-Do List?",
          description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
          itemText: task,
          listKey: LOCALSTORAGE_KEYS.TODO_LIST,
          listName: "To-Do List",
          onConfirm: () => addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List"),
        });
        setIsAlertDialogOpen(true);
      } else {
        toast({ title: "No task specified", description: "Please specify a task for the to-do list.", variant: "default" });
        setIsLoading(false);
      }
    } else if (lowerText.startsWith(WAKE_WORDS.DELETE_ITEM_PREFIX.toLowerCase())) {
        const commandArgs = textToProcess.substring(WAKE_WORDS.DELETE_ITEM_PREFIX.length).trim();
        let listKey = "";
        let listName = "";
        let itemIdentifierStr = "";

        if (commandArgs.toLowerCase().includes(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())) {
            listKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
            listName = "Shopping List";
            itemIdentifierStr = commandArgs.substring(0, commandArgs.toLowerCase().indexOf(WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase())).trim();
        } else if (commandArgs.toLowerCase().includes(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())) {
            listKey = LOCALSTORAGE_KEYS.TODO_LIST;
            listName = "To-Do List";
            itemIdentifierStr = commandArgs.substring(0, commandArgs.toLowerCase().indexOf(WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase())).trim();
        }

        if (listKey && itemIdentifierStr) {
            const lowerIdentifierStr = itemIdentifierStr.toLowerCase();
            if (lowerIdentifierStr.startsWith(WAKE_WORDS.ITEM_NUMBER_PREFIX.toLowerCase())) {
                const numberStr = lowerIdentifierStr.substring(WAKE_WORDS.ITEM_NUMBER_PREFIX.length).trim();
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
        const processedData = await processTextThought(simulatedText); // processTextThought for simulated text
        const newThought: Thought = { id: crypto.randomUUID(), timestamp: Date.now(), ...processedData };
        onThoughtRecalled(newThought);
        setInputText(''); 
        toast({ title: "Thought Processed", description: "AI processing of simulated recall complete." });
      } catch (error) {
        toast({ title: "Error Processing Simulated Recall", description: (error as Error).message, variant: "destructive" });
      } finally {
        setIsLoading(false);
      }
    } else {
      // General text processing, checking for AI suggested action items
      try {
        const processedData = await processTextThought(textToProcess);
        let listActionTriggered = false;
        if (processedData.actionItems && processedData.actionItems.length > 0) {
          for (const action of processedData.actionItems) {
            const lowerAction = action.toLowerCase();
            
            // Regex for: add '...' to ... shopping list
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

            // Regex for: add '...' to ... to-do list
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
        } else {
          // If an AlertDialog is open, loading will be reset when it closes or confirms.
          // Input text is cleared by addListItem if confirmed.
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


  // Main useEffect for "HegSync" wake word and command recognition
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
        // onend will set recognitionRef.current to null
      }
      return;
    }

    if (hasMicPermission === true && recognitionRef.current === null) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;
      recognition.continuous = true; // Keep listening through pauses until a command is fully processed or it times out
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
        commandProcessedSuccessfullyRef.current = false; // New session, no command processed yet
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        // Only clear utterance if a command was fully processed or we weren't in partial detection
        if (commandProcessedSuccessfullyRef.current || !partialWakeWordDetectedRef.current) {
            partialWakeWordDetectedRef.current = false;
            utteranceTranscriptRef.current = '';
        }
        // inputText is NOT cleared here, it's populated by onresult for user to process
        recognitionRef.current = null; // Essential for useEffect to re-initialize
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          // These are common, console.warn removed as per user request
          // console.warn('Main command recognition warning:', event.error, event.message || "(No specific message)");
        } else {
          console.error('Main command recognition error:', event.error, event.message || "(No specific message)");
        }
        // Resetting flags as if the command attempt concluded, to allow restart
        commandProcessedSuccessfullyRef.current = true; // Treat as command cycle end for restart logic
        partialWakeWordDetectedRef.current = false; // Clear partial detection

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Issue", variant: "destructive", description: "Speech recognition service denied. Check browser settings or permissions." });
        } else if (event.error === 'network') {
          toast({ title: "Network Error", variant: "destructive", description: "A network error occurred with the speech recognition service."});
        }
        // onend will be called after onerror, which handles setting recognitionRef.current to null
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
            // Append only the new finalized segment
            utteranceTranscriptRef.current = (utteranceTranscriptRef.current + (utteranceTranscriptRef.current ? " " : "") + finalizedSegmentThisTurn).trim();
        }
        
        const latestInterimForPartialCheck = interimTranscriptThisTurn.trim().toLowerCase();
        if (!partialWakeWordDetectedRef.current && latestInterimForPartialCheck.includes(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
          partialWakeWordDetectedRef.current = true;
        }
        
        // Update inputText with the live transcript (accumulated final + current interim)
        setInputText((utteranceTranscriptRef.current ? utteranceTranscriptRef.current + " " : "") + interimTranscriptThisTurn.trim());

        const lastResultIsFinal = event.results[event.results.length - 1].isFinal;
        if (lastResultIsFinal && utteranceTranscriptRef.current) {
          const finalUtterance = utteranceTranscriptRef.current.trim(); 
          const finalLower = finalUtterance.toLowerCase().trim();
          
          commandProcessedSuccessfullyRef.current = true; // Assume command is processed unless it's just "hegsync"

          if (finalLower === WAKE_WORDS.TURN_LISTENING_OFF.toLowerCase()) {
            onToggleListeningParent(false);
            setInputText(''); 
            utteranceTranscriptRef.current = ''; 
            partialWakeWordDetectedRef.current = false;
          } else if (finalLower === WAKE_WORDS.TURN_LISTENING_ON.toLowerCase()) {
            onToggleListeningParent(true);
            setInputText('');
            utteranceTranscriptRef.current = '';
            partialWakeWordDetectedRef.current = false;
          } else if (finalLower.startsWith(WAKE_WORDS.SET_BUFFER_TIME.toLowerCase())) {
            const spokenDuration = finalUtterance.substring(WAKE_WORDS.SET_BUFFER_TIME.length).trim();
            setBufferTimeByVoice(spokenDuration);
            setInputText('');
            utteranceTranscriptRef.current = '';
            partialWakeWordDetectedRef.current = false;
          } else if (finalLower === WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) {
            // Just "HegSync" was said, keep listening, don't stop.
            commandProcessedSuccessfullyRef.current = false; // Not a full command, so don't clear transcript on pause
            toast({ title: "HegSync Activated", description: "Awaiting your full command..." });
            // utteranceTranscriptRef.current is already "hegsync", ready for more.
          } else if (finalLower.startsWith(WAKE_WORDS.HEGSYNC_BASE.toLowerCase())) {
            // A "HegSync" command that needs to go to inputText for Brain processing
            // (e.g., replay that, add to list, delete, or unrecognized)
            // Text is already in inputText.
            // utteranceTranscriptRef is cleared by onend because commandProcessedSuccessfullyRef is true.
            toast({ title: "Command Captured", description: "Review in input area and click Brain icon to process." });
          } else {
            // Utterance didn't start with "HegSync" - treat as noise or unintentional speech.
            // Clear it so it doesn't clutter the input unless it was a very short utterance (might be a mistake)
             if (finalUtterance.length > WAKE_WORDS.HEGSYNC_BASE.length + 5) { // Heuristic: if longer than "hegsync" + a short command
                toast({ title: "Unrelated Speech Detected", description: "Ignored. Say 'HegSync' followed by your command." });
             }
            setInputText(''); // Clear non-command speech
            utteranceTranscriptRef.current = '';
            partialWakeWordDetectedRef.current = false;
            commandProcessedSuccessfullyRef.current = true; // Treat as processed cycle
          }

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
        // Request permission if it's in the 'prompt' state
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach(track => track.stop()); // Release the stream immediately
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
        recognitionRef.current.onstart = null; recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null; recognitionRef.current.onresult = null;
        commandProcessedSuccessfullyRef.current = true; // Ensure cleanup on unmount
        try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
        recognitionRef.current = null;
      }
      // Cleanup for dashboard dictation mic
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        dashboardDictationRecognitionRef.current = null;
      }
      if (dashboardDictationPauseTimeoutRef.current) {
        clearTimeout(dashboardDictationPauseTimeoutRef.current);
      }
      // Cleanup for long recording mic
      if (longRecordingSpeechRecognizerRef.current) {
        try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
        longRecordingSpeechRecognizerRef.current = null;
      }
      // if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
      //   try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
      //   if (longRecordingMediaRecorderRef.current?.stream) {
      //     longRecordingMediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      //   }
      //   longRecordingMediaRecorderRef.current = null;
      // }
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
        // Proceed to start dictation after granting permission
      } catch (err) {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", variant: "destructive"});
        return;
      }
    }

    if (isDashboardDictationActive) {
      if (dashboardDictationRecognitionRef.current) {
        try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        // onend will handle setIsDashboardDictationActive(false) and processing
      }
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      return;
    }

    // Stop main command listener if it's running
    commandProcessedSuccessfullyRef.current = true; 
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    
    setIsDashboardDictationActive(true);
    dashboardDictationAccumulatedTranscriptRef.current = ''; // Clear for new dictation
    setInputText(''); // Clear textarea for live dictation

    dashboardDictationRecognitionRef.current = new SpeechRecognitionAPI();
    const recognition = dashboardDictationRecognitionRef.current;
    recognition.continuous = true; 
    recognition.interimResults = true; 
    recognition.lang = 'en-US';

    recognition.onstart = () => { /* isDashboardDictationActive already true */ };
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      
      let interim = "";
      let finalSinceLastResult = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalSinceLastResult += event.results[i][0].transcript + " ";
        else interim += event.results[i][0].transcript;
      }

      if (finalSinceLastResult) {
        dashboardDictationAccumulatedTranscriptRef.current = (dashboardDictationAccumulatedTranscriptRef.current + finalSinceLastResult).trim();
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
        setInputText(finalSpokenText); // Set final text without "end/stop"
        if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
        // Processing will happen in onend
      } else {
        dashboardDictationPauseTimeoutRef.current = setTimeout(() => {
          if (dashboardDictationRecognitionRef.current) try { dashboardDictationRecognitionRef.current.stop(); } catch(e) {/*ignore*/}
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
      dashboardDictationAccumulatedTranscriptRef.current = ''; // Clear accumulated on error
    };
    recognition.onend = () => {
      if (dashboardDictationPauseTimeoutRef.current) clearTimeout(dashboardDictationPauseTimeoutRef.current);
      setIsDashboardDictationActive(false);
      // Text is already in inputText. User clicks Brain icon to process manually.
      // Do not auto-process here. Just ensure the final transcript (which is already set in inputText by onresult) remains.
      dashboardDictationRecognitionRef.current = null; 
      // dashboardDictationAccumulatedTranscriptRef.current = ''; // Don't clear here, it's now in inputText
      toast({title: "Dictation Ended", description: "Text populated in input area. Click Brain icon to process."})
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
  };
  
  const parseSpokenBufferTime = (spokenDuration: string): BufferTimeValue | null => {
    const cleanedSpoken = spokenDuration.toLowerCase().trim();
    if (cleanedSpoken.includes('always on') || cleanedSpoken.includes('continuous')) return 'continuous';
    for (const option of BUFFER_TIME_OPTIONS) {
      if (option.value !== 'continuous') {
        const match = cleanedSpoken.match(new RegExp(`^(${option.value})\\s*(minute|min)s?$`));
        if (match && match[1] === option.value) return option.value;
        if (cleanedSpoken === option.value) return option.value;
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
    if (isDashboardDictationActive) return <Radio className="h-5 w-5 text-red-500 animate-pulse" />; // Specific for dashboard dictation
    if (partialWakeWordDetectedRef.current) return <Mic className="h-5 w-5 text-yellow-500 animate-pulse" />;
    if (isRecognizingSpeech) return <Mic className="h-5 w-5 text-primary animate-pulse" />; // Main listener active
    if (isListening && hasMicPermission && !isBrowserUnsupported && !isLoading) return <Mic className="h-5 w-5 text-primary" />; // Primed
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
    if (partialWakeWordDetectedRef.current) return <>'<strong>HegSync</strong>' detected, awaiting command...</>;
    if (isRecognizingSpeech) return <>Say '<strong>HegSync</strong>' + command</>; // Main listener active
    if (isListening && hasMicPermission && !isBrowserUnsupported) return <>Listener active for '<strong>HegSync</strong>'</>; // Primed
    return "Voice status checking...";
  };

  const getTextareaPlaceholder = (): string => {
    if (isActivelyLongRecordingInternal || isExternallyLongRecording) return "Continuous recording active. Speech will populate here when stopped. Click Brain icon to process.";
    if (isDashboardDictationActive) return "Listening for dictation... Say 'HegSync end' or 'HegSync stop' to finish. Then click Brain icon to process.";
    if (isLoading && !isAlertDialogOpen) return "Processing...";
    if (!isListening) return "Enable passive listening to use voice or type input.";
    if (partialWakeWordDetectedRef.current) return "'HegSync' detected. Finish your command. Text will appear here. Click Brain icon to process.";
    if (isRecognizingSpeech) return "Listener active for 'HegSync'. Spoken commands will appear here. Click Brain icon to process.";
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
            Voice commands populate the text area. Click the <Brain className="inline-block h-3.5 w-3.5 mx-0.5"/> icon to process.
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
              disabled={!isListening || isLoading || (isActivelyLongRecordingInternal || isExternallyLongRecording)}
              className="resize-none"
              aria-label="Thought input area"
            />
            <div className="flex items-stretch gap-2">
              <Button
                type="button" 
                onClick={handleProcessInputText}
                disabled={!isListening || isLoading || isActivelyLongRecordingInternal || isExternallyLongRecording || !inputText.trim()}
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
                disabled={!isListening || isLoading || isActivelyLongRecordingInternal || isExternallyLongRecording || (isRecognizingSpeech && !isDashboardDictationActive && !partialWakeWordDetectedRef.current) || hasMicPermission !== true}
                size="icon"
                className="p-2 h-auto"
                aria-label="Dictate thought into text area"
                title="Dictate directly into input area (ends on pause or 'HegSync end/stop')"
              >
                {getDashboardDictationButtonIcon()}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
                The <q><strong>HegSync</strong> {WAKE_WORDS.RECALL_THOUGHT.substring(WAKE_WORDS.HEGSYNC_BASE.length)}</q> voice command processes a simulated thought from your buffer.
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
                // setInputText(''); // Cleared by addListItem or if no action taken.
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
              <AlertDialogCancel onClick={() => { /* State handled by onOpenChange */ setInputText(''); }}>Cancel</AlertDialogCancel>
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

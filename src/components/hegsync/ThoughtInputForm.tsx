"use client";

import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Brain, Loader2, AlertTriangleIcon, MicOff, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle as UiAlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { processTextThought, processRecordedAudio } from '@/lib/actions';
import type { Thought, ShoppingListItem, ToDoListItem, IntentAnalysisOutput } from '@/lib/types';
import { WAKE_WORDS, LOCALSTORAGE_KEYS, RECORDING_DURATION_MS } from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  onEmptyRecalledThoughts: () => void; // New prop
  isExternallyLongRecording: boolean;
  onStopLongRecordingParent: () => void;
}

export interface ThoughtInputFormHandle {
  startLongRecording: () => boolean;
  stopLongRecordingAndProcess: () => void;
}

export const ThoughtInputForm = forwardRef<ThoughtInputFormHandle, ThoughtInputFormProps>(
  ({ onThoughtRecalled, onEmptyRecalledThoughts, isExternallyLongRecording, onStopLongRecordingParent }, ref) => {
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();
    
    const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
    const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
    
    // Continuous recording (header mic)
    const [isCapturingAudioForLongRecording, setIsCapturingAudioForLongRecording] = useState(false);
    const longRecordingMediaRecorderRef = useRef<MediaRecorder | null>(null);
    const longRecordingSpeechRecognizerRef = useRef<SpeechRecognition | null>(null);
    const longRecordingTranscriptRef = useRef<string>('');
    const longRecordingAudioChunksRef = useRef<Blob[]>([]);

    // Alert Dialog
    const [alertDialogConfig, setAlertDialogConfig] = useState<{
      title: string;
      description: React.ReactNode;
      itemText?: string;
      listKey?: string;
      listName?: string;
      dataToRecallOnCancel?: Omit<Thought, "id" | "timestamp">;
      onConfirm: () => void;
      actionLabel?: string;
    } | null>(null);
    const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
    const confirmedDialogActionRef = useRef(false);

    const addListItem = useCallback((listKey: string, itemTextToAdd: string, listName: string) => {
      const item = itemTextToAdd.trim();
      if (!item) {
        toast({ title: "No item specified", description: `Please specify the item to add to ${listName}.`, variant: "default" });
        return;
      }
      try {
        const currentItemsString = localStorage.getItem(listKey);
        let currentItems: Array<ShoppingListItem | ToDoListItem> = currentItemsString ? JSON.parse(currentItemsString) : [];

        if (listKey === LOCALSTORAGE_KEYS.SHOPPING_LIST) {
          const newItem: ShoppingListItem = { id: crypto.randomUUID(), text: item, completed: false };
          currentItems = [...currentItems, newItem] as ShoppingListItem[];
        } else if (listKey === LOCALSTORAGE_KEYS.TODO_LIST) {
          const newItem: ToDoListItem = {
            id: crypto.randomUUID(),
            text: item,
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
        toast({ title: "Item Added", description: `"${item}" added to your ${listName}.` });
      } catch (error) {
        console.error(`Error adding to ${listName}:`, error);
        toast({ title: `Error updating ${listName}`, description: "Could not save the item.", variant: "destructive" });
      }
    }, [toast]);

    const deleteListItem = useCallback((listKey: string, identifier: string | number, listName: string) => {
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
          const itemFound = currentItems.find(item => item.text.toLowerCase() === lowerIdentifier);
          if (itemFound) deletedItemText = itemFound.text;

          const originalLength = currentItems.length;
          currentItems = currentItems.filter(item => item.text.toLowerCase() !== lowerIdentifier);
          if (currentItems.length < originalLength) {
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
      }
    }, [toast]);

    const clearShoppingList = useCallback(() => {
        localStorage.setItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, JSON.stringify([]));
        window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.SHOPPING_LIST, newValue: JSON.stringify([]) }));
        toast({ title: "Shopping List Cleared" });
    }, [toast]);

    const completeAllToDoTasks = useCallback(() => {
        try {
            const currentItemsString = localStorage.getItem(LOCALSTORAGE_KEYS.TODO_LIST);
            let currentItems: ToDoListItem[] = currentItemsString ? JSON.parse(currentItemsString) : [];
            const updatedItems = currentItems.map(item => ({ ...item, completed: true }));
            localStorage.setItem(LOCALSTORAGE_KEYS.TODO_LIST, JSON.stringify(updatedItems));
            window.dispatchEvent(new StorageEvent('storage', { key: LOCALSTORAGE_KEYS.TODO_LIST, newValue: JSON.stringify(updatedItems) }));
            toast({ title: "All To-Do Tasks Marked Complete" });
        } catch (error) {
            toast({ title: "Error Updating To-Do List", variant: "destructive" });
        }
    }, [toast]);


    const handleProcessInputText = useCallback(async () => {
      const textToProcess = inputText.trim();
      if (!textToProcess) {
        toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
        return;
      }
      
      setIsLoading(true);
      const hegglesBaseLower = WAKE_WORDS.HEGGLES_BASE.toLowerCase();
      const lowerText = textToProcess.toLowerCase();

      const shoppingListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_SHOPPING_LIST_PREFIX.substring(hegglesBaseLower.length).trim()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_SHOPPING_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const shoppingListAddMatch = lowerText.match(shoppingListAddPattern);
      
      const todoListAddPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.ADD_TO_TODO_LIST_PREFIX.substring(hegglesBaseLower.length).trim()}\\s+(.+?)(?:\\s+${WAKE_WORDS.TO_TODO_LIST_SUFFIX_REGEX_PART.toLowerCase()})?$`);
      const todoListAddMatch = lowerText.match(todoListAddPattern);
            
      const deleteListPattern = new RegExp(`^${hegglesBaseLower}\\s+${WAKE_WORDS.DELETE_ITEM_PREFIX.substring(hegglesBaseLower.length).trim()}\\s+(.*?)(?:\\s+${WAKE_WORDS.FROM_SHOPPING_LIST_TRIGGER.toLowerCase()}|\\s+${WAKE_WORDS.FROM_TODO_LIST_TRIGGER.toLowerCase()})$`);
      const deleteListMatch = lowerText.match(deleteListPattern);

      // New command checks
      if (lowerText === WAKE_WORDS.EMPTY_RECENT_THOUGHTS_COMMAND.toLowerCase()) {
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
            title: "Empty Recent Thoughts?",
            description: "Are you sure you want to clear all thoughts from the 'Recent Thoughts' list on the dashboard?",
            onConfirm: () => {
                onEmptyRecalledThoughts();
            },
            actionLabel: "Empty Thoughts"
        });
        setIsAlertDialogOpen(true);
        return; // Dialog will handle isLoading and inputText reset
      }

      if (lowerText === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
            title: "Clear Shopping List?",
            description: "Are you sure you want to remove all items from your shopping list?",
            onConfirm: clearShoppingList,
            actionLabel: "Clear List"
        });
        setIsAlertDialogOpen(true);
        return;
      }
      
      const completeAllPatternPart = WAKE_WORDS.COMPLETE_ALL_TASKS_PREFIX.toLowerCase();
      const completeAllSuffixTodo = WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO.toLowerCase();
      const completeAllSuffixTodos = WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS.toLowerCase();

      if (lowerText.startsWith(completeAllPatternPart) && 
          (lowerText.endsWith(completeAllSuffixTodo) || lowerText.endsWith(completeAllSuffixTodos))) {
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
            title: "Complete All To-Do Tasks?",
            description: "Are you sure you want to mark all tasks in your to-do list as complete?",
            onConfirm: completeAllToDoTasks,
            actionLabel: "Complete All"
        });
        setIsAlertDialogOpen(true);
        return;
      }


      if (shoppingListAddMatch && shoppingListAddMatch[1]) {
        const item = shoppingListAddMatch[1].trim();
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
          title: "Add to Shopping List?",
          description: <>Do you want to add <strong>"{item}"</strong> to your shopping list?</>,
          itemText: item,
          listKey: LOCALSTORAGE_KEYS.SHOPPING_LIST,
          listName: "Shopping List",
          onConfirm: () => {
            addListItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, item, "Shopping List");
          },
          actionLabel: "Add Item"
        });
        setIsAlertDialogOpen(true);
        return; 
      } else if (todoListAddMatch && todoListAddMatch[1]) {
        const task = todoListAddMatch[1].trim();
        confirmedDialogActionRef.current = false;
        setAlertDialogConfig({
          title: "Add to To-Do List?",
          description: <>Do you want to add <strong>"{task}"</strong> to your to-do list?</>,
          itemText: task,
          listKey: LOCALSTORAGE_KEYS.TODO_LIST,
          listName: "To-Do List",
          onConfirm: () => {
            addListItem(LOCALSTORAGE_KEYS.TODO_LIST, task, "To-Do List");
          },
          actionLabel: "Add Task"
        });
        setIsAlertDialogOpen(true);
        return;
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
          confirmedDialogActionRef.current = false;
          const itemNumberPrefixLower = WAKE_WORDS.ITEM_NUMBER_PREFIX.toLowerCase();
          let isDeletingByNumber = false;
          let itemNumberToDelete = -1;
          let itemNameToDelete = itemIdentifierStr;

          if (itemIdentifierStr.toLowerCase().startsWith(itemNumberPrefixLower)) {
            const numberStr = itemIdentifierStr.substring(itemNumberPrefixLower.length).trim();
            itemNumberToDelete = parseInt(numberStr, 10);
            if (!isNaN(itemNumberToDelete) && itemNumberToDelete > 0) {
              isDeletingByNumber = true;
            } else {
              toast({ title: "Invalid Item Number", description: `"${numberStr}" is not a valid number.`, variant: "default" });
              setIsLoading(false);
              setInputText('');
              return;
            }
          }
          
          setAlertDialogConfig({
            title: `Delete from ${listName}?`,
            description: isDeletingByNumber 
              ? <>Are you sure you want to delete item number <strong>{itemNumberToDelete}</strong> from your {listName}?</>
              : <>Are you sure you want to delete "<strong>{itemNameToDelete}</strong>" from your {listName}?</>,
            onConfirm: () => {
              if (isDeletingByNumber) {
                deleteListItem(listKey, itemNumberToDelete, listName);
              } else {
                deleteListItem(listKey, itemNameToDelete, listName);
              }
            },
            actionLabel: "Delete"
          });
          setIsAlertDialogOpen(true);
          return; 
        } else {
          toast({ title: "Deletion Command Incomplete", description: "Specify item and list (e.g., '...from my shopping list').", variant: "default" });
        }
        setInputText('');
        setIsLoading(false);
      } else { 
        try {
          const processedData = await processTextThought(textToProcess);
          let dialogShownForAISuggestion = false;
          let dataToRecallIfDialogCancelled: Omit<Thought, "id" | "timestamp"> | undefined = processedData;

          // Check AI intent analysis for actions
          if (processedData.intentAnalysis?.isAction &&
              processedData.intentAnalysis.extractedAction &&
              processedData.intentAnalysis.suggestedList &&
              processedData.intentAnalysis.suggestedList !== 'none') {
            
            const action = processedData.intentAnalysis.extractedAction;
            const listKey = processedData.intentAnalysis.suggestedList === 'shopping' ? LOCALSTORAGE_KEYS.SHOPPING_LIST : LOCALSTORAGE_KEYS.TODO_LIST;
            const listName = processedData.intentAnalysis.suggestedList === 'shopping' ? "Shopping List" : "To-Do List";
            
            // Check if this AI suggested action matches one of the new direct commands
            const lowerAction = action.toLowerCase();
            if (listName === "Shopping List" && lowerAction === WAKE_WORDS.CLEAR_SHOPPING_LIST_COMMAND.toLowerCase()) {
                confirmedDialogActionRef.current = false;
                setAlertDialogConfig({
                    title: "AI Suggestion: Clear Shopping List?",
                    description: "The AI understood this as a command to clear your shopping list. Proceed?",
                    onConfirm: clearShoppingList,
                    actionLabel: "Clear List",
                    dataToRecallOnCancel: dataToRecallIfDialogCancelled
                });
            } else if (listName === "To-Do List" && lowerAction.startsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_PREFIX.toLowerCase()) && (lowerAction.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODO.toLowerCase()) || lowerAction.endsWith(WAKE_WORDS.COMPLETE_ALL_TASKS_COMMAND_SUFFIX_TODOS.toLowerCase()))) {
                confirmedDialogActionRef.current = false;
                setAlertDialogConfig({
                    title: "AI Suggestion: Complete All To-Do Tasks?",
                    description: "The AI understood this as a command to complete all to-do tasks. Proceed?",
                    onConfirm: completeAllToDoTasks,
                    actionLabel: "Complete All",
                    dataToRecallOnCancel: dataToRecallIfDialogCancelled
                });
            } else { // Default AI suggestion for adding an item
                confirmedDialogActionRef.current = false;
                setAlertDialogConfig({
                  title: `AI Suggestion: Add to ${listName}?`,
                  description: <>The AI suggests adding "<strong>{action}</strong>" to your {listName}. Add it?</>,
                  itemText: action,
                  listKey: listKey,
                  listName: listName,
                  dataToRecallOnCancel: dataToRecallIfDialogCancelled,
                  onConfirm: () => {
                    addListItem(listKey, action, listName);
                  },
                  actionLabel: listName === "Shopping List" ? "Add Item" : "Add Task"
                });
            }
            setIsAlertDialogOpen(true);
            dialogShownForAISuggestion = true;
            return; 
          } 
          // Check refined action items (less prioritized than direct intent)
          else if (processedData.actionItems && processedData.actionItems.length > 0 && !dialogShownForAISuggestion) {
            for (const actionItem of processedData.actionItems) {
              const lowerActionItem = actionItem.toLowerCase();
              let itemToAdd: string | null = null;
              let targetListKey: string | null = null;
              let targetListName: string | null = null;

              const shoppingPatternRefined = new RegExp(`(?:add|buy|get|purchase|pick up)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?shopping\\s+list)?$`);
              const todoPatternRefined = new RegExp(`(?:add|schedule|create|complete|do|finish|call|email|text|set up|organize|remember to)\\s+(?:['"]?)(.+?)(?:['"]?)(?:\\s+(?:to|for|in|on)\\s+(?:my\\s+|the\\s+)?(?:to\\s*do|todo)\\s+list)?$`);

              const shoppingMatchRefined = lowerActionItem.match(shoppingPatternRefined);
              if (shoppingMatchRefined && shoppingMatchRefined[1]) {
                itemToAdd = shoppingMatchRefined[1].trim();
                targetListKey = LOCALSTORAGE_KEYS.SHOPPING_LIST;
                targetListName = "Shopping List";
              } else {
                const todoMatchRefined = lowerActionItem.match(todoPatternRefined);
                if (todoMatchRefined && todoMatchRefined[1]) {
                  itemToAdd = todoMatchRefined[1].trim();
                  targetListKey = LOCALSTORAGE_KEYS.TODO_LIST;
                  targetListName = "To-Do List";
                }
              }

              if (itemToAdd && targetListKey && targetListName) {
                confirmedDialogActionRef.current = false;
                setAlertDialogConfig({
                  title: `AI Suggestion: Add to ${targetListName}?`,
                  description: <>The AI refined this to: "<strong>{actionItem}</strong>". Add "<strong>{itemToAdd}</strong>" to your {targetListName}?</>,
                  itemText: itemToAdd,
                  listKey: targetListKey,
                  listName: targetListName,
                  dataToRecallOnCancel: dataToRecallIfDialogCancelled,
                  onConfirm: () => {
                    addListItem(targetListKey!, itemToAdd!, targetListName!);
                  },
                  actionLabel: targetListName === "Shopping List" ? "Add Item" : "Add Task"
                });
                setIsAlertDialogOpen(true);
                dialogShownForAISuggestion = true;
                return; 
              }
            }
          }

          if (!dialogShownForAISuggestion) {
             onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...processedData });
             toast({ title: "Thought Processed", description: processedData.aiAnswer ? "AI answered your question." : "AI analysis complete." });
             setInputText('');
             setIsLoading(false);
          }
        } catch (error) {
          toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
          setIsLoading(false);
        }
      }
    }, [inputText, toast, onThoughtRecalled, addListItem, deleteListItem, onEmptyRecalledThoughts, clearShoppingList, completeAllToDoTasks]);
    

    // Effect to check for mic permission on mount
    useEffect(() => {
      const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        setIsBrowserUnsupported(true);
        setHasMicPermission(false);
        return;
      }
      setIsBrowserUnsupported(false);

      if (hasMicPermission === null) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach(track => track.stop()); 
            setHasMicPermission(true);
          })
          .catch(err => {
            console.warn("Microphone permission request error:", err.name, err.message);
            setHasMicPermission(false);
          });
      }
    }, [hasMicPermission]);


    const startLongRecording = useCallback((): boolean => {
        if (hasMicPermission !== true || isLoading || isCapturingAudioForLongRecording) {
          if (hasMicPermission !== true) toast({title: "Cannot Start Recording", description: "Microphone permission missing."});
          else toast({title: "Cannot Start Recording", description: "System busy."});
          return false;
        }
        
        const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognitionAPI || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast({ title: "Browser Not Supported", description: "Audio recording or speech recognition not supported.", variant: "destructive" });
          return false;
        }

        const startRecordingFlow = async () => {
          try {
            setIsCapturingAudioForLongRecording(true);
            longRecordingTranscriptRef.current = '';
            longRecordingAudioChunksRef.current = [];
            setInputText(''); 

            longRecordingSpeechRecognizerRef.current = new SpeechRecognitionAPI();
            const recognizer = longRecordingSpeechRecognizerRef.current;
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.lang = 'en-US';

            recognizer.onstart = () => {}; 

            recognizer.onresult = (event: SpeechRecognitionEvent) => {
              let interimTranscript = "";
              let finalTranscriptForThisResultSegment = "";
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                  finalTranscriptForThisResultSegment += event.results[i][0].transcript + ' ';
                } else {
                  interimTranscript += event.results[i][0].transcript;
                }
              }
              if (finalTranscriptForThisResultSegment) {
                longRecordingTranscriptRef.current = (longRecordingTranscriptRef.current + finalTranscriptForThisResultSegment).trim();
              }
              setInputText(longRecordingTranscriptRef.current + (interimTranscript ? " " + interimTranscript.trim() : ""));
            };
            recognizer.onerror = (event: SpeechRecognitionErrorEvent) => {
               if (event.error === 'aborted') {
                console.info("Continuous recording speech recognition aborted (likely intentional stop):", event.message);
              } else if (event.error === 'no-speech') {
                console.warn("Continuous recording speech recognition: No speech detected.", event.message);
              } else {
                console.error("Continuous recording speech recognition error:", event.error, event.message);
                toast({ title: "Continuous Recording Transcription Error", description: event.message, variant: "destructive" });
              }
            };
            recognizer.onend = () => {
              longRecordingSpeechRecognizerRef.current = null;
            };
            recognizer.start();

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            longRecordingMediaRecorderRef.current = new MediaRecorder(stream);
            longRecordingMediaRecorderRef.current.ondataavailable = (event) => {
              if (event.data.size > 0) {
                longRecordingAudioChunksRef.current.push(event.data);
              }
            };
            longRecordingMediaRecorderRef.current.onstop = async () => {
              stream.getTracks().forEach(track => track.stop());
              const finalTranscriptToSet = longRecordingTranscriptRef.current.trim();
              
              setIsCapturingAudioForLongRecording(false); 
              setInputText(finalTranscriptToSet); 
              onStopLongRecordingParent(); 

              if (finalTranscriptToSet) {
                toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
              } else {
                toast({ title: "Recording Stopped", description: "No speech detected during recording." });
              }
              longRecordingAudioChunksRef.current = []; 
            };
            longRecordingMediaRecorderRef.current.start();
            return true; 

          } catch (err) {
            console.error("Error starting continuous recording:", err);
            toast({ title: "Continuous Recording Error", description: `Could not start recording: ${(err as Error).message}`, variant: "destructive" });
            setIsCapturingAudioForLongRecording(false); 
            if (longRecordingSpeechRecognizerRef.current) { try { longRecordingSpeechRecognizerRef.current.stop(); } catch (e) {/* ignore */}}
            if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
              try { longRecordingMediaRecorderRef.current.stop(); } catch (e) {/* ignore */}
            }
            onStopLongRecordingParent(); 
            return false; 
          }
        };
        return startRecordingFlow();
    }, [
      hasMicPermission, isLoading, isCapturingAudioForLongRecording,
      toast, setInputText, onStopLongRecordingParent 
    ]);

    const stopLongRecordingAndProcess = useCallback(() => {
        if (!isCapturingAudioForLongRecording) return;

        if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) { /* ignore */ }
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
          try { longRecordingMediaRecorderRef.current.stop(); } catch(e) { 
            console.error("Error stopping media recorder:", e);
            const finalTranscript = longRecordingTranscriptRef.current.trim();
            setIsCapturingAudioForLongRecording(false);
            onStopLongRecordingParent();
            setInputText(finalTranscript); // Ensure inputText is set even if stop errors
             if (finalTranscript) {
               toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
             } else {
               toast({ title: "Recording Stopped", description: "No speech detected." });
             }
          }
        } else { // If somehow media recorder is not in recording state but we think it is
          const finalTranscript = longRecordingTranscriptRef.current.trim();
          setIsCapturingAudioForLongRecording(false);
          onStopLongRecordingParent();
          setInputText(finalTranscript);
           if (finalTranscript) {
             toast({ title: "Recording Stopped", description: "Transcript populated. Click Brain icon to process." });
           } else {
             toast({ title: "Recording Stopped", description: "No speech detected." });
           }
        }
    }, [isCapturingAudioForLongRecording, setInputText, onStopLongRecordingParent, toast]);

    // Effect to sync with parent's long recording toggle
    useEffect(() => {
        if (isExternallyLongRecording && !isCapturingAudioForLongRecording) {
            startLongRecording();
        } else if (!isExternallyLongRecording && isCapturingAudioForLongRecording) {
            stopLongRecordingAndProcess();
        }
    }, [isExternallyLongRecording, isCapturingAudioForLongRecording, startLongRecording, stopLongRecordingAndProcess]);


    useImperativeHandle(ref, () => ({
      startLongRecording,
      stopLongRecordingAndProcess,
    }));
    
    // Cleanup effect for long recording refs
    useEffect(() => {
      return () => {
         if (longRecordingSpeechRecognizerRef.current) {
          try { longRecordingSpeechRecognizerRef.current.stop(); } catch(e) {/*ignore*/}
          longRecordingSpeechRecognizerRef.current = null;
        }
        if (longRecordingMediaRecorderRef.current && longRecordingMediaRecorderRef.current.state === "recording") {
            try { longRecordingMediaRecorderRef.current.stop(); } catch(e) {/*ignore*/}
            longRecordingMediaRecorderRef.current = null;
        }
      };
    }, []);
    
    const getTextareaPlaceholder = (): string => {
      if (isCapturingAudioForLongRecording) return "Continuous recording active. Transcript populates here. Click Brain icon to process when stopped.";
      if (isLoading && !isAlertDialogOpen) return "Processing...";
      return "Type thought, paste text, or use header mic for continuous recording. Click Brain icon to process.";
    };
    
    return (
      <>
        <Card className="w-full shadow-lg">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl">Input & Recall</CardTitle>
            </div>
            <CardDescription>
             Use the header microphone for continuous recording. Transcript will appear below. Click the Brain icon to process.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isBrowserUnsupported && (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Browser Not Supported</UiAlertTitle>
                  <AlertDescription>Speech recognition for continuous recording may not be supported. Manual input available.</AlertDescription>
                </Alert>
              )}
              {hasMicPermission === false && !isBrowserUnsupported && ( 
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <UiAlertTitle>Microphone Access Denied</UiAlertTitle>
                  <AlertDescription>Continuous recording requires microphone access. Manual input available.</AlertDescription>
                </Alert>
              )}

              <Textarea
                placeholder={getTextareaPlaceholder()}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={4}
                disabled={isLoading || isCapturingAudioForLongRecording }
                className="resize-none"
                aria-label="Thought input area"
              />
              <div className="flex items-stretch gap-2">
                <Button
                  type="button"
                  onClick={handleProcessInputText}
                  disabled={isLoading || isCapturingAudioForLongRecording || !inputText.trim()}
                  size="icon"
                  aria-label="Process text from input area with AI"
                  title="Process text from input area with AI"
                  variant="outline"
                >
                  {(isLoading && !isAlertDialogOpen && inputText.trim()) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {alertDialogConfig && (
          <AlertDialog
            open={isAlertDialogOpen}
            onOpenChange={(open) => {
              setIsAlertDialogOpen(open);
              if (!open) { 
                if (!confirmedDialogActionRef.current && alertDialogConfig.dataToRecallOnCancel) {
                  onThoughtRecalled({ id: crypto.randomUUID(), timestamp: Date.now(), ...alertDialogConfig.dataToRecallOnCancel });
                  toast({ title: "Suggestion Declined", description: "Original thought captured in Recent Thoughts." });
                }
                confirmedDialogActionRef.current = false; 
                setAlertDialogConfig(null); 
                setIsLoading(false); 
                setInputText('');    
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{alertDialogConfig.title}</AlertDialogTitle>
                <AlertDialogDescription>
                  {alertDialogConfig.description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => { setInputText(''); }}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  if (alertDialogConfig) {
                    confirmedDialogActionRef.current = true; 
                    alertDialogConfig.onConfirm();
                  }
                }}>{alertDialogConfig.actionLabel || "Confirm"}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  });

ThoughtInputForm.displayName = "ThoughtInputForm";
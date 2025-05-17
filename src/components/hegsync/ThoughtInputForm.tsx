
"use client";

import { useState, useEffect, useRef } from 'react';
import { Brain, Loader2, Mic, MicOff, AlertTriangleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { processRecalledAudio } from '@/lib/actions';
import type { Thought, ShoppingListItem } from '@/lib/types';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; // Global passive listening state from parent
}

const WAKE_WORD_RECALL = "hegsync replay that";
const WAKE_WORD_SHOPPING_ADD = "hegsync add to my shopping list";
const SHOPPING_LIST_STORAGE_KEY = 'hegsync-shopping-list';

export function ThoughtInputForm({ onThoughtRecalled, isListening }: ThoughtInputFormProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const wakeWordForRecallDetectedRef = useRef(false); // For "replay that"

  const processThoughtInputWithAI = async () => {
    if (!inputText.trim()) {
      toast({ title: "Input empty", description: "Please provide some text to recall.", variant: "destructive" });
      return;
    }
    if (!isListening && !wakeWordForRecallDetectedRef.current) {
      toast({ title: "Listening Inactive", description: "Please enable passive listening to recall a thought.", variant: "destructive" });
      return;
    }

    if (recognitionRef.current && isRecognizingSpeech) {
      recognitionRef.current.stop(); 
    }
    
    setIsLoading(true);
    try {
      const processedData = await processRecalledAudio(inputText);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      setInputText(''); // Clear input text after successful recall
      toast({ title: "Thought Recalled", description: "AI processing complete." });
    } catch (error) {
      toast({ title: "Error Recalling Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      wakeWordForRecallDetectedRef.current = false; // Reset flag
      // Speech recognition restart is handled by its 'onend' logic if isListening is still true.
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    wakeWordForRecallDetectedRef.current = false; 
    await processThoughtInputWithAI();
  };

  const addShoppingListItem = (itemText: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: "Please say the item you want to add after '...add to my shopping list'.", variant: "default" });
      return;
    }
    try {
      const currentItemsString = localStorage.getItem(SHOPPING_LIST_STORAGE_KEY);
      const currentItems: ShoppingListItem[] = currentItemsString ? JSON.parse(currentItemsString) : [];
      const newItem: ShoppingListItem = {
        id: crypto.randomUUID(),
        text: itemText.trim(),
        completed: false,
      };
      const updatedItems = [...currentItems, newItem];
      localStorage.setItem(SHOPPING_LIST_STORAGE_KEY, JSON.stringify(updatedItems));
      toast({ title: "Item Added to Shopping List", description: `"${itemText.trim()}" added.` });
    } catch (error) {
      console.error("Error adding to shopping list:", error);
      toast({ title: "Error updating Shopping List", description: "Could not save the item.", variant: "destructive" });
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

    if (!isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecognizingSpeech(false);
      return;
    }

    if (isRecognizingSpeech || hasMicPermission === false || isLoading) {
      return;
    }
    
    if (hasMicPermission === null) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => {
          setHasMicPermission(true);
        })
        .catch(err => {
          console.error("Microphone permission error:", err);
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", description: "Voice commands require microphone access. Please enable it in your browser settings.", variant: "destructive" });
        });
      return; 
    }

    recognitionRef.current = new SpeechRecognitionAPI();
    const recognition = recognitionRef.current;

    recognition.continuous = true;
    recognition.interimResults = false; 
    recognition.lang = 'en-US';

    let restartTimer: NodeJS.Timeout | null = null;

    recognition.onstart = () => {
      setIsRecognizingSpeech(true);
    };

    recognition.onend = () => {
      setIsRecognizingSpeech(false);
      if (isListening && hasMicPermission && !isLoading && recognitionRef.current && !wakeWordForRecallDetectedRef.current) {
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (isListening && hasMicPermission && !isLoading && recognitionRef.current) { 
            try {
              if (!isRecognizingSpeech) recognitionRef.current.start(); 
            } catch (e) {
              console.warn("Recognition restart prevented or failed:", e);
            }
          }
        }, 300); 
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error, event.message);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setHasMicPermission(false);
        toast({ title: "Microphone Access Denied", description: "Please enable microphone access in browser settings for voice commands.", variant: "destructive" });
      } else if (event.error === 'no-speech') {
        // Normal, onend will handle restart
      } else if (event.error === 'network') {
        toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
      } else if (event.error === 'aborted') {
        // Usually means stop() was called, which is fine.
      } else {
        toast({ title: "Speech Error", description: `Voice recognition faced an issue: ${event.error}`, variant: "destructive"});
      }
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      const command = finalTranscript.trim().toLowerCase();

      if (command.startsWith(WAKE_WORD_SHOPPING_ADD)) {
        const itemToAdd = command.substring(WAKE_WORD_SHOPPING_ADD.length).trim();
        if (itemToAdd) {
          toast({ title: "Shopping List Command Detected!", description: `Adding "${itemToAdd}"...` });
          addShoppingListItem(itemToAdd);
        } else {
          toast({ title: "Shopping List Command", description: "Please specify an item to add after '...add to my shopping list'.", variant: "default" });
        }
        // Recognition will auto-restart via onend if isListening is still true
      } else if (command.includes(WAKE_WORD_RECALL)) {
        toast({ title: "Recall Wake Word Detected!", description: "Processing your thought from the text area..." });
        if (inputText.trim()) {
          wakeWordForRecallDetectedRef.current = true; 
          processThoughtInputWithAI(); 
        } else {
          toast({ title: "Input Empty for Recall", description: "Please type or paste the thought to process before using the 'replay that' command.", variant: "default" });
          wakeWordForRecallDetectedRef.current = false; 
        }
      }
    };

    try {
      if(!isRecognizingSpeech) recognition.start();
    } catch (e) {
      console.error("Failed to start speech recognition:", e);
      setHasMicPermission(false); 
      toast({ title: "Mic Init Failed", description: "Could not start voice recognition. Check mic & browser permissions.", variant: "destructive" });
    }

    return () => {
      if (restartTimer) clearTimeout(restartTimer);
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setIsRecognizingSpeech(false);
    };
  // Removed processThoughtInputWithAI from dependencies to prevent re-renders during speech recognition init
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [isListening, toast, inputText, isLoading, hasMicPermission, onThoughtRecalled]); 

  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Recall Thought / Add to List</CardTitle>
          {isListening && hasMicPermission && !isBrowserUnsupported && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" title={isRecognizingSpeech ? "Listening for voice commands" : "Voice commands inactive"}>
              {isRecognizingSpeech ? <Mic className="h-5 w-5 text-primary animate-pulse" /> : <MicOff className="h-5 w-5" />}
              <span>{isRecognizingSpeech ? "Listening..." : "Voice Paused"}</span>
            </div>
          )}
        </div>
        <CardDescription>
          {isListening
            ? `Use the text area and "Process with AI" for recalling thoughts. Or say:
              "${WAKE_WORD_RECALL}" to process text area content.
              "${WAKE_WORD_SHOPPING_ADD} [item name]" to add to your shopping list.`
            : "Enable passive listening above to recall thoughts or use voice commands."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isBrowserUnsupported && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Browser Not Supported</AlertTitle>
            <AlertDescription>
              Speech recognition for voice commands is not supported by your browser. Manual input is still available.
            </AlertDescription>
          </Alert>
        )}
        {isListening && hasMicPermission === false && !isBrowserUnsupported && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangleIcon className="h-4 w-4" />
            <AlertTitle>Microphone Access Denied</AlertTitle>
            <AlertDescription>
              Voice commands require microphone access. Please enable it in your browser settings and refresh. Manual input for thoughts is still available.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleManualSubmit} className="space-y-4">
          <Textarea
            placeholder={isListening ? "For 'Recall Thought': Paste or type your thought here..." : "Enable listening to activate input..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            disabled={!isListening || isLoading}
            className="resize-none"
            aria-label="Recalled thought input area"
          />
          <div className="flex items-stretch gap-2">
            <Button 
              type="submit" 
              disabled={!isListening || isLoading || !inputText.trim()} 
              className="flex-grow"
              aria-label="Process thought with AI (uses text area content)"
              title="Process thought with AI (uses text area content)"
            >
              {isLoading && wakeWordForRecallDetectedRef.current ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              Process Thought (from text)
            </Button>
            <Button
              type="submit"
              disabled={!isListening || isLoading || !inputText.trim()}
              size="icon"
              className="p-2 h-auto" 
              aria-label="Process thought with AI (uses text area content)"
              title="Process thought with AI (uses text area content)"
            >
              <Brain className={`h-5 w-5 ${isLoading && wakeWordForRecallDetectedRef.current ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Voice commands for shopping list operate independently of the text area.
        </p>
      </CardContent>
    </Card>
  );
}
    

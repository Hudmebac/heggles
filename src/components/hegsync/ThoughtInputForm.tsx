
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
import { 
  WAKE_WORDS, 
  LOCALSTORAGE_KEYS, 
  BUFFER_TIME_OPTIONS, 
  DEFAULT_BUFFER_TIME,
  SIMULATED_RECALL_PREFIX,
  SIMULATED_RECALL_SUFFIX
} from '@/lib/constants';

interface ThoughtInputFormProps {
  onThoughtRecalled: (thought: Thought) => void;
  isListening: boolean; // Global passive listening state from parent
}

export function ThoughtInputForm({ onThoughtRecalled, isListening }: ThoughtInputFormProps) {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [isRecognizingSpeech, setIsRecognizingSpeech] = useState(false);
  const [isBrowserUnsupported, setIsBrowserUnsupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  
  const processThoughtInputWithAI = async (textToProcess: string) => {
    if (!textToProcess.trim()) {
      toast({ title: "Input empty", description: "Cannot process an empty thought.", variant: "destructive" });
      setIsLoading(false); // Ensure loading is reset
      return;
    }

    setIsLoading(true);
    try {
      const processedData = await processRecalledAudio(textToProcess);
      const newThought: Thought = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...processedData,
      };
      onThoughtRecalled(newThought);
      // Only clear inputText if the processed text was from the inputText (manual submission)
      if (textToProcess === inputText) {
        setInputText(''); 
      }
      toast({ title: "Thought Processed", description: "AI processing complete." });
    } catch (error) {
      toast({ title: "Error Processing Thought", description: (error as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
        toast({ title: "Input empty", description: "Please provide some text to recall.", variant: "destructive" });
        return;
    }
    await processThoughtInputWithAI(inputText);
  };

  const addShoppingListItem = (itemText: string) => {
    if (!itemText.trim()) {
      toast({ title: "No item specified", description: `Please say the item you want to add after '${WAKE_WORDS.ADD_TO_SHOPPING_LIST}'.`, variant: "default" });
      return;
    }
    try {
      const currentItemsString = localStorage.getItem(LOCALSTORAGE_KEYS.SHOPPING_LIST);
      const currentItems: ShoppingListItem[] = currentItemsString ? JSON.parse(currentItemsString) : [];
      const newItem: ShoppingListItem = {
        id: crypto.randomUUID(),
        text: itemText.trim(),
        completed: false,
      };
      const updatedItems = [...currentItems, newItem];
      localStorage.setItem(LOCALSTORAGE_KEYS.SHOPPING_LIST, JSON.stringify(updatedItems));
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

    if (!isListening || hasMicPermission === false || isLoading) {
      if (recognitionRef.current && isRecognizingSpeech) {
        recognitionRef.current.stop();
      }
      return;
    }
    
    if (hasMicPermission === null) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => setHasMicPermission(true))
        .catch(err => {
          console.error("Microphone permission error:", err);
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", description: "Voice commands require microphone access. Please enable it in your browser settings.", variant: "destructive" });
        });
      return; 
    }

    if (!recognitionRef.current && !isRecognizingSpeech) {
      recognitionRef.current = new SpeechRecognitionAPI();
      const recognition = recognitionRef.current;

      recognition.continuous = true;
      recognition.interimResults = false; 
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsRecognizingSpeech(true);
      };

      recognition.onend = () => {
        setIsRecognizingSpeech(false);
        recognitionRef.current = null; 
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error, event.message);
        setIsRecognizingSpeech(false);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setHasMicPermission(false);
          toast({ title: "Microphone Access Denied", description: "Please enable microphone access in browser settings for voice commands.", variant: "destructive" });
        } else if (event.error === 'no-speech' || event.error === 'aborted') {
          // Normal, onend will handle state, useEffect will handle restart if needed
        } else if (event.error === 'network') {
          toast({ title: "Network Error", description: "Speech recognition might require a network connection.", variant: "destructive"});
        } else {
          toast({ title: "Speech Error", description: `Voice recognition faced an issue: ${event.error}`, variant: "destructive"});
        }
        recognitionRef.current = null;
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        const command = finalTranscript.trim().toLowerCase();

        if (command.startsWith(WAKE_WORDS.ADD_TO_SHOPPING_LIST)) {
          recognitionRef.current?.stop();
          const itemToAdd = command.substring(WAKE_WORDS.ADD_TO_SHOPPING_LIST.length).trim();
          if (itemToAdd) {
            toast({ title: "Shopping List Command Detected!", description: `Adding "${itemToAdd}"...` });
            addShoppingListItem(itemToAdd);
          } else {
            toast({ title: "Shopping List Command", description: `Please specify an item to add after '${WAKE_WORDS.ADD_TO_SHOPPING_LIST}'.`, variant: "default" });
          }
        } else if (command.includes(WAKE_WORDS.RECALL_THOUGHT)) {
          recognitionRef.current?.stop();
          toast({ title: "Recall Wake Word Detected!", description: "Processing simulated audio buffer..." });
          
          const bufferTimeValue = localStorage.getItem(LOCALSTORAGE_KEYS.BUFFER_TIME) || DEFAULT_BUFFER_TIME;
          const bufferOption = BUFFER_TIME_OPTIONS.find(opt => opt.value === bufferTimeValue);
          const bufferTimeLabel = bufferOption ? bufferOption.label : `${bufferTimeValue} Minutes`;
          
          const simulatedText = `${SIMULATED_RECALL_PREFIX} ${bufferTimeLabel} ${SIMULATED_RECALL_SUFFIX}`;
          processThoughtInputWithAI(simulatedText); 
        }
      };
      
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
      }
    }
    
    return () => {
      if (recognitionRef.current && isRecognizingSpeech) {
        try {
            recognitionRef.current.onstart = null;
            recognitionRef.current.onend = null;
            recognitionRef.current.onerror = null;
            recognitionRef.current.onresult = null;
            recognitionRef.current.stop();
        } catch(e) {
            console.warn("Error stopping recognition in cleanup:", e);
        }
      }
      recognitionRef.current = null;
      setIsRecognizingSpeech(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [isListening, hasMicPermission, isLoading]); 

  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">Recall & Shopping via Voice / Text</CardTitle>
          {isListening && hasMicPermission === true && !isBrowserUnsupported && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" title={isRecognizingSpeech ? "Listening for voice commands" : "Voice commands inactive/starting..."}>
              {isRecognizingSpeech ? <Mic className="h-5 w-5 text-primary animate-pulse" /> : <MicOff className="h-5 w-5" />}
              <span>{isRecognizingSpeech ? "Listening..." : (isLoading ? "Processing..." : "Voice Paused")}</span>
            </div>
          )}
        </div>
        <CardDescription>
          {isListening
            ? `Voice: Say "${WAKE_WORDS.RECALL_THOUGHT}" (uses simulated buffer) or "${WAKE_WORDS.ADD_TO_SHOPPING_LIST} [item name]".
               Text: Use area below and "Process Thought" button.`
            : "Enable passive listening above to use voice commands or text input."}
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
            placeholder={isListening ? "For manual 'Process Thought': Paste or type text here. Voice command 'replay that' uses a simulated buffer." : "Enable listening to activate input..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={4}
            disabled={!isListening || isLoading}
            className="resize-none"
            aria-label="Recalled thought input area for manual processing"
          />
          <div className="flex items-stretch gap-2">
            <Button 
              type="submit" 
              disabled={!isListening || isLoading || !inputText.trim()} 
              className="flex-grow"
              aria-label="Process thought from text area with AI"
              title="Process thought from text area with AI"
            >
              {isLoading && inputText.trim() ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Brain className="mr-2 h-4 w-4" />}
              Process Thought (from text)
            </Button>
            <Button
              type="submit"
              disabled={!isListening || isLoading || !inputText.trim()}
              size="icon"
              className="p-2 h-auto" 
              aria-label="Process thought from text area with AI"
              title="Process thought from text area with AI"
            >
              <Brain className={`h-5 w-5 ${isLoading && inputText.trim() ? 'animate-pulse' : ''}`} />
            </Button>
          </div>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Voice command for shopping list operates independently of the text area.
          Voice command for recalling thoughts uses a simulated audio buffer based on your settings.
        </p>
      </CardContent>
    </Card>
  );
}
    

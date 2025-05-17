
"use client";

import { useState, useEffect, FormEvent, useRef, useCallback } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { ShoppingListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListChecks, Trash2, Edit3, PlusCircle, Save, Ban, Mic, MicOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { WAKE_WORDS, LOCALSTORAGE_KEYS } from '@/lib/constants';

export default function ShoppingListPage() {
  const [items, setItems] = useLocalStorage<ShoppingListItem[]>(LOCALSTORAGE_KEYS.SHOPPING_LIST, []);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState('');
  const { toast } = useToast();

  const [isClient, setIsClient] = useState(false);

  // State for inline voice input for adding items
  const [isListeningForItemInput, setIsListeningForItemInput] = useState(false);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // State for page-level "HegSync" wake word detection
  const [isListeningForPageHegsync, setIsListeningForPageHegsync] = useState(false);
  const [pageHegsyncMicPermission, setPageHegsyncMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const pageHegsyncRecognitionRef = useRef<SpeechRecognition | null>(null);
  // This ref helps control the restart behavior of the pageHegsync listener
  const pageHegsyncListenerShouldBeActive = useRef(true);


  useEffect(() => {
    setIsClient(true);
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setMicPermission('unsupported');
      setPageHegsyncMicPermission('unsupported');
    } else {
        // Initial permission check for pageHegsync listener if not already determined
        if (pageHegsyncMicPermission === 'prompt') {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    stream.getTracks().forEach(track => track.stop());
                    setPageHegsyncMicPermission('granted');
                })
                .catch(() => {
                    setPageHegsyncMicPermission('denied');
                });
        }
    }
  }, [pageHegsyncMicPermission]);


  const handleAddItem = (e: FormEvent) => {
    e.preventDefault();
    if (!newItemText.trim()) {
      toast({ title: "Item cannot be empty", variant: "destructive" });
      return;
    }
    setItems([...items, { id: crypto.randomUUID(), text: newItemText.trim(), completed: false }]);
    setNewItemText('');
    toast({ title: "Item Added", description: `"${newItemText.trim()}" added to your list.` });
  };

  const handleDeleteItem = (id: string) => {
    const itemToDelete = items.find(item => item.id === id);
    setItems(items.filter(item => item.id !== id));
    if (itemToDelete) {
      toast({ title: "Item Deleted", description: `"${itemToDelete.text}" removed from your list.` });
    }
  };

  const handleToggleComplete = (id: string) => {
    setItems(items.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
  };

  const handleStartEdit = (item: ShoppingListItem) => {
    setEditingItemId(item.id);
    setEditingItemText(item.text);
  };

  const handleSaveEdit = () => {
    if (!editingItemText.trim()) {
      toast({ title: "Item cannot be empty", variant: "destructive" });
      return;
    }
    setItems(items.map(item => item.id === editingItemId ? { ...item, text: editingItemText.trim() } : item));
    toast({ title: "Item Updated" });
    setEditingItemId(null);
    setEditingItemText('');
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setEditingItemText('');
  };

  const startInputRecognition = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || micPermission !== 'granted') return;

    if (recognitionRef.current && recognitionRef.current.stop) {
      try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    }
    
    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListeningForItemInput(true);
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results).map(result => result[0]).map(result => result.transcript).join('');
      setNewItemText(transcript);
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Shopping list item input speech recognition error:', event.error, event.message);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicPermission('denied');
        toast({ title: "Microphone Access Denied", variant: "destructive" });
      } else if (event.error === 'no-speech') {
        toast({ title: "No speech detected", variant: "default" });
      } else {
        toast({ title: "Voice Input Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsListeningForItemInput(false);
    };
    recognition.onend = () => {
      setIsListeningForItemInput(false);
      recognitionRef.current = null;
      pageHegsyncListenerShouldBeActive.current = true; // Allow page HegSync listener to restart
    };
    
    setNewItemText(''); 
    recognition.start();
  }, [micPermission, toast]);

  const triggerItemInputMic = useCallback(async () => {
    if (isListeningForItemInput) { // If already listening for item, stop it
      if (recognitionRef.current?.stop) {
        try { recognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      setIsListeningForItemInput(false);
      return;
    }

    if (micPermission === 'unsupported') {
      toast({ title: "Voice input not supported", variant: "destructive" });
      return;
    }
    if (micPermission === 'denied') {
      toast({ title: "Microphone Access Denied", variant: "destructive" });
      return;
    }

    let currentPermission = micPermission;
    if (micPermission === 'prompt') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setMicPermission('granted');
        currentPermission = 'granted';
      } catch (err) {
        setMicPermission('denied');
        toast({ title: "Microphone Access Denied", variant: "destructive" });
        return;
      }
    }
    
    if (currentPermission === 'granted') {
      pageHegsyncListenerShouldBeActive.current = false; // Stop page HegSync listener
      if (pageHegsyncRecognitionRef.current?.stop) {
         try { pageHegsyncRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      startInputRecognition();
    }
  }, [isListeningForItemInput, micPermission, startInputRecognition, toast]);


  // useEffect for page-level "Hegsync" wake word listener
  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || pageHegsyncMicPermission !== 'granted' || isListeningForItemInput || !pageHegsyncListenerShouldBeActive.current) {
      if (pageHegsyncRecognitionRef.current?.stop) {
        try { pageHegsyncRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      return;
    }

    if (!pageHegsyncRecognitionRef.current) {
      const pageRecognition = new SpeechRecognitionAPI();
      pageHegsyncRecognitionRef.current = pageRecognition;
      pageRecognition.continuous = true;
      pageRecognition.interimResults = false;
      pageRecognition.lang = 'en-US';

      pageRecognition.onstart = () => setIsListeningForPageHegsync(true);
      pageRecognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        if (transcript === WAKE_WORDS.HEGSYNC_BASE.toLowerCase()) {
          toast({ title: `'${WAKE_WORDS.HEGSYNC_BASE}' Detected`, description: "Activating item input microphone..." });
          pageHegsyncListenerShouldBeActive.current = false; // Prevent auto-restart before item input
          pageHegsyncRecognitionRef.current?.stop(); // Stop this listener
          triggerItemInputMic(); // Activate the item input mic
        }
      };
      pageRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Page Hegsync recognition error:', event.error, event.message);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setPageHegsyncMicPermission('denied'); // Update permission state
        }
        setIsListeningForPageHegsync(false);
        pageHegsyncRecognitionRef.current = null;
      };
      pageRecognition.onend = () => {
        setIsListeningForPageHegsync(false);
        pageHegsyncRecognitionRef.current = null;
        // The listener will be restarted by this effect if pageHegsyncListenerShouldBeActive.current is true
        // and other conditions (like isListeningForItemInput being false) are met.
      };
      
      try {
        if (pageHegsyncListenerShouldBeActive.current) pageRecognition.start();
      } catch (e) {
        console.error("Failed to start page Hegsync recognition:", e);
        setIsListeningForPageHegsync(false);
        pageHegsyncRecognitionRef.current = null;
      }
    }
    
    return () => {
      if (pageHegsyncRecognitionRef.current?.stop) {
         try { pageHegsyncRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      pageHegsyncRecognitionRef.current = null;
      setIsListeningForPageHegsync(false);
    };
  }, [pageHegsyncMicPermission, isListeningForItemInput, triggerItemInputMic, toast]);


  if (!isClient) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <ListChecks className="h-16 w-16 animate-pulse text-primary" />
      </div>
    );
  }

  const micButtonDisabled = micPermission === 'unsupported' || micPermission === 'denied';
  const pageHegsyncStatusText = isListeningForPageHegsync ? "Listening for 'HegSync'..." : (pageHegsyncMicPermission === 'granted' ? "Say 'HegSync' to activate input" : "Page 'HegSync' listener off");

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-center">
        <div className="flex items-center gap-3">
            <ListChecks className="h-10 w-10 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Shopping List</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-2 sm:mt-0">{pageHegsyncMicPermission === 'granted' && !isListeningForItemInput ? pageHegsyncStatusText : ""}</p>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl">Add New Item</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddItem} className="flex items-center gap-2 sm:gap-3">
            <Input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="E.g., Milk, Eggs, Bread"
              className="flex-grow"
              aria-label="New shopping list item"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={triggerItemInputMic}
              disabled={micButtonDisabled && micPermission !== 'prompt'}
              title={micButtonDisabled && micPermission !== 'prompt' ? "Voice input unavailable" : (isListeningForItemInput ? "Stop voice input" : "Add item using voice")}
              aria-label="Add item using voice"
            >
              {isListeningForItemInput ? <Mic className="h-5 w-5 text-primary animate-pulse" /> :
               (micButtonDisabled ? <MicOff className="h-5 w-5 text-muted-foreground" /> : <Mic className="h-5 w-5" />)}
            </Button>
            <Button type="submit" aria-label="Add item" className="px-3 sm:px-4">
              <PlusCircle className="mr-0 sm:mr-2 h-5 w-5" />
              <span className="hidden sm:inline">Add Item</span>
            </Button>
          </form>
        </CardContent>
      </Card>

      {items.length > 0 ? (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">Your Items ({items.filter(i => !i.completed).length} remaining)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 p-3 bg-card-foreground/5 rounded-md transition-all hover:bg-card-foreground/10"
                >
                  <span className="mr-1 font-medium text-muted-foreground w-6 text-right">{(index + 1)}.</span>
                  <Checkbox
                    id={`item-${item.id}`}
                    checked={item.completed}
                    onCheckedChange={() => handleToggleComplete(item.id)}
                    aria-labelledby={`item-text-${item.id}`}
                  />
                  {editingItemId === item.id ? (
                    <Input
                      type="text"
                      value={editingItemText}
                      onChange={(e) => setEditingItemText(e.target.value)}
                      onBlur={handleSaveEdit} 
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      autoFocus
                      className="flex-grow h-9"
                      aria-label="Edit item text"
                    />
                  ) : (
                    <span
                      id={`item-text-${item.id}`}
                      className={`flex-grow cursor-pointer ${item.completed ? 'line-through text-muted-foreground' : ''}`}
                      onClick={() => !item.completed && handleStartEdit(item)}
                      title={!item.completed ? "Click to edit" : ""}
                    >
                      {item.text}
                    </span>
                  )}
                  {editingItemId === item.id ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={handleSaveEdit} title="Save changes">
                        <Save className="h-5 w-5 text-green-600" />
                      </Button>
                       <Button variant="ghost" size="icon" onClick={handleCancelEdit} title="Cancel editing">
                        <Ban className="h-5 w-5 text-muted-foreground" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      {!item.completed && (
                        <Button variant="ghost" size="icon" onClick={() => handleStartEdit(item)} title="Edit item">
                          <Edit3 className="h-5 w-5 text-blue-600" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteItem(item.id)} title="Delete item">
                        <Trash2 className="h-5 w-5 text-red-600" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-12">
          <ListChecks className="mx-auto h-16 w-16 text-muted-foreground mb-6 opacity-50" />
          <h3 className="text-2xl font-semibold">Your Shopping List is Empty</h3>
          <p className="text-muted-foreground mt-2">Add items using the form above to get started.</p>
        </div>
      )}
    </div>
  );
}


    
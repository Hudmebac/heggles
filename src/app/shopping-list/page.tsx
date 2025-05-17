
"use client";

import { useState, useEffect, FormEvent, useRef } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { ShoppingListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListChecks, Trash2, Edit3, PlusCircle, Save, Ban, Mic, MicOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function ShoppingListPage() {
  const [items, setItems] = useLocalStorage<ShoppingListItem[]>('hegsync-shopping-list', []);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState('');
  const { toast } = useToast();

  const [isClient, setIsClient] = useState(false);

  // State for inline voice input
  const [isListeningForItemInput, setIsListeningForItemInput] = useState(false);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    setIsClient(true);
    // Check for SpeechRecognition support on mount
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setMicPermission('unsupported');
    }

    // Cleanup function
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        if (recognitionRef.current.stop) {
          try { recognitionRef.current.stop(); } catch (e) { console.warn("Error stopping recognition on unmount:", e); }
        }
        recognitionRef.current = null;
      }
    };
  }, []);


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

  // Voice Input specific functions
  const startInputRecognition = () => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || micPermission !== 'granted') {
      if (micPermission === 'unsupported') toast({ title: "Voice input not supported", variant: "destructive" });
      else if (micPermission === 'denied') toast({ title: "Mic access denied", variant: "destructive" });
      return;
    }

    if (recognitionRef.current && recognitionRef.current.stop) {
        try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    }

    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListeningForItemInput(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map(result => result[0])
        .map(result => result.transcript)
        .join('');
      setNewItemText(transcript);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Shopping list item input speech recognition error:', event.error, event.message);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicPermission('denied');
        toast({ title: "Microphone Access Denied", description: "Voice input requires microphone access.", variant: "destructive" });
      } else if (event.error === 'no-speech') {
        toast({ title: "No speech detected", description: "Please try speaking again.", variant: "default" });
      } else {
        toast({ title: "Voice Input Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsListeningForItemInput(false);
    };

    recognition.onend = () => {
      setIsListeningForItemInput(false);
      // Consider not nullifying recognitionRef.current here if we want an explicit stop button to work more cleanly with it
    };
    
    setNewItemText(''); // Clear input field before starting voice input
    recognition.start();
  };

  const handleMicButtonClick = async () => {
    if (isListeningForItemInput) {
      if (recognitionRef.current && recognitionRef.current.stop) {
        try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
      }
      setIsListeningForItemInput(false); // Explicitly set, onend might be delayed
      return;
    }

    if (micPermission === 'unsupported') {
      toast({ title: "Voice input not supported", description: "Your browser doesn't support speech recognition.", variant: "destructive" });
      return;
    }
    
    if (micPermission === 'denied') {
      toast({ title: "Microphone Access Denied", description: "Please enable microphone access in browser settings.", variant: "destructive" });
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
        console.error("Mic permission error (shopping input):", err);
        setMicPermission('denied');
        toast({ title: "Microphone Access Denied", description: "Voice input for items requires microphone access.", variant: "destructive" });
        return;
      }
    }
    
    if (currentPermission === 'granted') {
      startInputRecognition();
    }
  };


  if (!isClient) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <ListChecks className="h-16 w-16 animate-pulse text-primary" />
      </div>
    );
  }

  const micButtonDisabled = micPermission === 'unsupported' || micPermission === 'denied';

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <ListChecks className="h-10 w-10 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Shopping List</h1>
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
              onClick={handleMicButtonClick}
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


"use client";

import { useState, useEffect, FormEvent, useRef, useCallback } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { ShoppingListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';import { Label } from "@/components/ui/label";
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

  const [isListeningForItemInput, setIsListeningForItemInput] = useState(false);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  useEffect(() => {
    setIsClient(true);
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setMicPermission('unsupported');
    }
    return () => {
      if (recognitionRef.current && recognitionRef.current.stop) {
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleExportList = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(items, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "shopping-list.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    toast({ title: "Shopping List Exported" });
  };

  const handleExportTemplate = () => {
    const comments = "# This is a template for importing your shopping list.\\n" +
                     "# Each row should represent a shopping list item.\\n" +
                     "# The first column ('text') is required and should contain the item name.\\n" +
                     "# The second column ('completed') is required and should be 'true' or 'false'.\\n";
    const header = "text,completed\\n";
    const csvContent = comments + header + "Example Item 1,false\\nExample Item 2,true\\n";
    const downloadAnchorNode = document.createElement('a');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    downloadAnchorNode.setAttribute("href", url);
    downloadAnchorNode.setAttribute("download", "shopping-list_template.csv");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    URL.revokeObjectURL(url);
    toast({ title: "Shopping List Template Exported" });
  };

  const handleImportList = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const lines = csvText.split(/[\\r\\n]+/).filter(line => line.trim() !== '' && !line.startsWith('#'));
        if (lines.length === 0) {
           toast({ title: "Import Failed", description: "File is empty.", variant: "destructive" });
           return;
        }
        const headerRow = lines[0].split(',');
        const textIndex = headerRow.findIndex(h => h.trim().toLowerCase() === 'text');
        const completedIndex = headerRow.findIndex(h => h.trim().toLowerCase() === 'completed');

        if (textIndex === -1 || completedIndex === -1) {
          toast({ title: "Import Failed", description: "CSV must contain 'text' and 'completed' columns.", variant: "destructive" });
           return;
        }

        const importedItems: ShoppingListItem[] = lines.slice(1).map(line => {
           const values = line.split(',');
           return { id: crypto.randomUUID(), text: values[textIndex]?.trim() || '', completed: values[completedIndex]?.trim().toLowerCase() === 'true' };
        }).filter(item => item.text !== '');
        setItems(importedItems);
        toast({ title: "Shopping List Imported", description: `${importedItems.length} items loaded.` });

      } catch (error) {
        toast({ title: "Import Failed", description: "Could not parse CSV file.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Clear the input
  };

  const startInputRecognition = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || micPermission !== 'granted') return;

    if (recognitionRef.current && recognitionRef.current.stop) {
      try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
    }
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }

    const recognition = new SpeechRecognitionAPI();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListeningForItemInput(true);
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }

      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        transcript += event.results[i][0].transcript;
      }

      const lowerTranscript = transcript.toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();

      if (lowerTranscript.endsWith(endCommand)) {
        transcript = transcript.substring(0, transcript.length - endCommand.length).trim();
        setNewItemText(transcript);
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
        }
      } else {
        setNewItemText(transcript);
        pauseTimeoutRef.current = setTimeout(() => {
          if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch(e) { /* ignore */ }
          }
        }, 2000);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
       if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
      if (event.error === 'aborted') {
        console.info('Shopping list item input speech recognition aborted:', event.message);
      } else if (event.error === 'no-speech') {
        if (isListeningForItemInput) {
          toast({ title: "No speech detected", variant: "default" });
        }
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.error('Shopping list item input speech recognition error:', event.error, event.message);
        setMicPermission('denied');
        toast({ title: "Microphone Access Denied", variant: "destructive" });
      } else {
        console.error('Shopping list item input speech recognition error:', event.error, event.message);
        toast({ title: "Voice Input Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsListeningForItemInput(false);
    };
    recognition.onend = () => {
      setIsListeningForItemInput(false);
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
      recognitionRef.current = null;
    };

    setNewItemText('');
    recognition.start();
  }, [micPermission, toast, isListeningForItemInput]);

  const triggerItemInputMic = useCallback(async () => {
    if (isListeningForItemInput) {
      if (recognitionRef.current?.stop) {
        try { recognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
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
      startInputRecognition();
    }
  }, [isListeningForItemInput, micPermission, startInputRecognition, toast]);


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
      <div className="flex flex-col sm:flex-row justify-between items-center">
        <div className="flex items-center gap-3">
            <ListChecks className="h-10 w-10 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Shopping List</h1>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4 sm:mt-0 items-center"> {/* Added items-center for vertical alignment */}
          <Button variant="outline" onClick={handleExportList} size="sm">Export List</Button>
          <Button variant="outline" onClick={handleExportTemplate} size="sm">Export Template</Button>
          <div className="flex items-center"> {/* Wrapper for label and input */}
            <Button variant="outline" size="sm" asChild>
              <Label htmlFor="import-shopping-list-file" className="cursor-pointer h-full flex items-center px-3">Import CSV</Label>
            </Button>
            <Input id="import-shopping-list-file" type="file" accept=".csv" className="hidden" onChange={handleImportList} />
          </div>
        </div>
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
              size="lg"
              className="p-2"
              onClick={triggerItemInputMic}
              disabled={micButtonDisabled && micPermission !== 'prompt'}
              title={micButtonDisabled && micPermission !== 'prompt' ? "Voice input unavailable" : (isListeningForItemInput ? "Stop voice input (or say 'Heggles end')" : "Add item using voice")}
              aria-label="Add item using voice"
            >
              {isListeningForItemInput ? <Mic className="h-6 w-6 text-primary animate-pulse" /> :
               (micButtonDisabled ? <MicOff className="h-6 w-6 text-muted-foreground" /> : <Mic className="h-6 w-6" />)}
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

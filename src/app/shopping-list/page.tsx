
"use client";

import { useState, useEffect, FormEvent, useRef, useCallback } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { ShoppingListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ListChecks, Trash2, Edit3, PlusCircle, Save, Ban, Mic, MicOff, Import, Share2, Mail, MessageSquare } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from '@/hooks/use-toast';
import { WAKE_WORDS, LOCALSTORAGE_KEYS, SHARE_DEFAULTS } from '@/lib/constants';
import { generateShoppingListPlainTextForShare } from '@/lib/list-export-utils';
import * as XLSX from 'xlsx';

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsClient(true);
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setMicPermission('unsupported');
    }
    return () => {
      if (recognitionRef.current && (recognitionRef.current as any).stop) {
        try { (recognitionRef.current as any).stop(); } catch (e) { /* ignore */ }
      }
      if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
      recognitionRef.current = null;
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

  const processCSVImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '' && !line.toLowerCase().startsWith('#'));
        
        if (lines.length === 0) {
           toast({ title: "Import Failed", description: "File is empty or contains only comments and a header.", variant: "destructive" });
           return;
        }

        const headerRow = lines[0].split(',').map(h => h.trim().toLowerCase());
        const textIndex = headerRow.indexOf('text');
        const completedIndex = headerRow.indexOf('completed');

        if (textIndex === -1 || completedIndex === -1) {
          toast({ title: "Import Failed", description: "CSV must contain 'text' and 'completed' columns in the header (case-insensitive).", variant: "destructive" });
          return;
        }
        
        if (lines.length <= 1) {
           toast({ title: "Import Failed", description: "No data rows found after the header.", variant: "destructive" });
           return;
        }

        const importedItems: ShoppingListItem[] = lines.slice(1).map(line => {
           const values = line.split(',');
           const textValue = values[textIndex]?.trim() || '';
           const cleanedText = textValue.startsWith('"') && textValue.endsWith('"') ? textValue.substring(1, textValue.length - 1).replace(/""/g, '"') : textValue;
           return { 
             id: crypto.randomUUID(), 
             text: cleanedText, 
             completed: values[completedIndex]?.trim().toLowerCase() === 'true' 
           };
        }).filter(item => item.text !== ''); 

        if (importedItems.length === 0) {
            toast({ title: "Import Warning", description: "No valid items could be imported from the CSV. Check data rows.", variant: "default" });
            return;
        }

        setItems(prevItems => [...prevItems, ...importedItems]);
        toast({ title: "Shopping List Imported", description: `${importedItems.length} items loaded from CSV and added to your list.` });
      } catch (error) {
        console.error("CSV Import Error:", error);
        toast({ title: "Import Failed", description: "Could not parse CSV file. Please check the file format and content.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };

  const processJSONImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonText = e.target?.result as string;
        const imported: Omit<ShoppingListItem, 'id'>[] = JSON.parse(jsonText);
        if (!Array.isArray(imported) || imported.some(item => typeof item.text !== 'string' || typeof item.completed !== 'boolean')) {
          throw new Error("Invalid JSON structure. Expected an array of objects with 'text' (string) and 'completed' (boolean) properties.");
        }
        const newItems = imported.map(item => ({...item, id: crypto.randomUUID() } as ShoppingListItem));
        setItems(prevItems => [...prevItems, ...newItems]);
        toast({ title: "Shopping List Imported", description: `${newItems.length} items loaded from JSON and added to your list.` });
      } catch (error) {
        console.error("JSON Import Error:", error);
        toast({ title: "Import Failed", description: (error as Error).message || "Could not parse JSON file.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };

  const processExcelImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (json.length === 0) {
            toast({ title: "Import Failed", description: "Excel file is empty or no data could be read.", variant: "destructive" });
            return;
        }
        
        const importedItems: ShoppingListItem[] = json.map(row => ({
          id: crypto.randomUUID(),
          text: String(row.text || '').trim(),
          completed: String(row.completed || '').toLowerCase() === 'true',
        })).filter(item => item.text !== ''); 

        if (importedItems.length === 0) {
            toast({ title: "Import Warning", description: "No valid items with text found in Excel. Ensure 'text' and 'completed' columns exist.", variant: "default" });
            return;
        }
        setItems(prevItems => [...prevItems, ...importedItems]);
        toast({ title: "Shopping List Imported", description: `${importedItems.length} items loaded from Excel and added to your list.` });
      } catch (error) {
        console.error("Excel Import Error:", error);
        toast({ title: "Import Failed", description: "Could not process Excel file. Ensure 'text' and 'completed' columns exist.", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
  };

  const processTextImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trim().startsWith('#'));
        if (lines.length === 0) {
          toast({ title: "Import Failed", description: "Text file is empty or contains only comments/whitespace.", variant: "destructive" });
          return;
        }
        const importedItems: ShoppingListItem[] = lines.map(line => ({
          id: crypto.randomUUID(),
          text: line.trim(),
          completed: false,
        }));
        setItems(prevItems => [...prevItems, ...importedItems]);
        toast({ title: "Shopping List Imported", description: `${importedItems.length} items loaded from Text file and added to your list.` });
      } catch (error) {
        console.error("Text File Import Error:", error);
        toast({ title: "Import Failed", description: "Could not process Text file.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };


  const handleFileSelectedForImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      toast({ title: "No file selected", variant: "default" });
      return;
    }

    const fileName = file.name.toLowerCase();
    try {
      if (fileName.endsWith('.csv')) {
        processCSVImport(file);
      } else if (fileName.endsWith('.json')) {
        processJSONImport(file);
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        processExcelImport(file);
      } else if (fileName.endsWith('.txt')) {
        processTextImport(file);
      } else {
        toast({ title: "Unsupported File Type", description: "Please select a CSV, JSON, Excel, or TXT file.", variant: "destructive" });
      }
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const startInputRecognition = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || micPermission !== 'granted') return;

    if (recognitionRef.current && (recognitionRef.current as any).stop) {
      try { (recognitionRef.current as any).stop(); } catch(e) { /* ignore */ }
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
      setNewItemText(transcript); // Update live

      const lowerTranscript = transcript.toLowerCase();
      const endCommand = WAKE_WORDS.END_DICTATION.toLowerCase();
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();


      if (lowerTranscript.endsWith(endCommand) || lowerTranscript.endsWith(stopCommand)) {
        let finalText = transcript;
        if (lowerTranscript.endsWith(endCommand)) {
            finalText = transcript.substring(0, transcript.length - endCommand.length).trim();
        } else if (lowerTranscript.endsWith(stopCommand)) {
            finalText = transcript.substring(0, transcript.length - stopCommand.length).trim();
        }
        setNewItemText(finalText);
        if (recognitionRef.current) {
          try { (recognitionRef.current as any).stop(); } catch(e) { /* ignore */ }
        }
      } else {
        pauseTimeoutRef.current = setTimeout(() => {
          if (recognitionRef.current) {
            try { (recognitionRef.current as any).stop(); } catch(e) { /* ignore */ }
          }
        }, 2000);
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
       if (pauseTimeoutRef.current) {
        clearTimeout(pauseTimeoutRef.current);
      }
      if (event.error === 'aborted') {
        console.info('Shopping list item input speech recognition aborted.');
      } else if (event.error === 'no-speech') {
        if (isListeningForItemInput) {
           // toast({ title: "No speech detected", variant: "default" }); 
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

    setNewItemText(''); // Clear input before starting dictation
    recognition.start();
  }, [micPermission, toast, isListeningForItemInput, setNewItemText]);

  const triggerItemInputMic = useCallback(async () => {
    if (isListeningForItemInput) {
      if (recognitionRef.current?.stop) {
        try { (recognitionRef.current as any).stop(); } catch(e) {/* ignore */}
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

  const handleShareViaEmail = () => {
    const plainTextList = generateShoppingListPlainTextForShare(items);
    const subject = SHARE_DEFAULTS.SHOPPING_LIST_EMAIL_SUBJECT;
    const body = plainTextList;
    const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailtoLink, '_blank');
  };

  const handleShareViaWhatsApp = () => {
    const plainTextList = generateShoppingListPlainTextForShare(items);
    const whatsappLink = `https://wa.me/?text=${encodeURIComponent(plainTextList)}`;
    window.open(whatsappLink, '_blank');
  };


  if (!isClient) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <ListChecks className="h-16 w-16 animate-pulse text-primary" />
      </div>
    );
  }

  const micButtonDisabled = micPermission === 'unsupported' || micPermission === 'denied';
  const visuallyHiddenStyle: React.CSSProperties = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: '0',
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-2">
        <div className="flex items-center gap-3">
            <ListChecks className="h-10 w-10 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Shopping List</h1>
        </div>
        <div className="flex items-center gap-2 mt-4 sm:mt-0">
          <Button 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              className="h-10"
              aria-label="Import shopping list items"
            >
              <Import className="mr-2 h-5 w-5" /> Import Items
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-10" aria-label="Share shopping list">
                <Share2 className="mr-2 h-5 w-5" /> Share List
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleShareViaEmail}>
                <Mail className="mr-2 h-4 w-4" />
                Share via Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleShareViaWhatsApp}>
                <MessageSquare className="mr-2 h-4 w-4" />
                Share via WhatsApp
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <input
        id="import-shopping-list-file"
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,.xlsx,.xls,.txt"
        style={visuallyHiddenStyle}
        onChange={handleFileSelectedForImport}
      />

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
              className="p-2 h-10 w-10 shrink-0"
              onClick={triggerItemInputMic}
              disabled={micButtonDisabled && micPermission !== 'prompt'}
              title={micButtonDisabled && micPermission !== 'prompt' ? "Voice input unavailable" : (isListeningForItemInput ? `Stop voice input (or say '${WAKE_WORDS.END_DICTATION}' or '${WAKE_WORDS.STOP_DICTATION}')` : "Add item using voice")}
              aria-label="Add item using voice"
            >
              {isListeningForItemInput ? <Mic className="h-6 w-6 text-primary animate-pulse" /> :
               (micButtonDisabled ? <MicOff className="h-6 w-6 text-muted-foreground" /> : <Mic className="h-6 w-6" />)}
            </Button>
            <Button type="submit" aria-label="Add item" className="px-3 sm:px-4 h-10">
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
          <p className="text-muted-foreground mt-2">Add items using the form above or import a list to get started.</p>
        </div>
      )}
    </div>
  );
}

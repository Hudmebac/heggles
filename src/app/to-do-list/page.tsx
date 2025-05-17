
"use client";

import { useState, useEffect, FormEvent, DragEvent, useMemo, useRef, useCallback } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { ToDoListItem, TimePoint, TimeSettingType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label';
import { format, parseISO, isValid, isPast, isToday, isTomorrow } from 'date-fns';
import { 
  ClipboardList, Trash2, Edit3, PlusCircle, Save, Ban, CheckSquare, Clock, 
  ChevronUp, ChevronDown, GripVertical, CalendarIcon, AlertTriangle, Mic, MicOff 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LOCALSTORAGE_KEYS, WAKE_WORDS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const initialTimePoint: TimePoint = { hh: '12', mm: '00', period: 'AM' };

// This function is no longer used directly for parsing the editor inputs,
// but retained as it might be useful for initializing from stored string values if needed.
// const parseTimeToTimePoint = (timeStr?: string | null): TimePoint | null => {
//   if (!timeStr) return null;
//   try {
//     if (timeStr === "AM" || timeStr === "PM") {
//       return { hh: '12', mm: '00', period: timeStr as 'AM' | 'PM' };
//     }
//     const [time, periodPart] = timeStr.split(' ');
//     if (!periodPart || !['AM', 'PM'].includes(periodPart.toUpperCase())) return null;
//     const [hh, mm] = time.split(':');
//     if (isNaN(parseInt(hh)) || isNaN(parseInt(mm))) return null;
//     return { hh, mm, period: periodPart.toUpperCase() as 'AM' | 'PM' };
//   } catch (e) {
//     return null;
//   }
// };

const formatTimePointToString = (timePoint?: TimePoint | null): string | null => {
  if (!timePoint || !timePoint.period) return null; 
  const hInput = timePoint.hh;
  const mInput = timePoint.mm;

  const hVal = (hInput === '' || hInput === null) ? 12 : parseInt(hInput, 10);
  const mVal = (mInput === '' || mInput === null) ? 0 : parseInt(mInput, 10);

  if (isNaN(hVal) || isNaN(mVal) || hVal < 1 || hVal > 12 || mVal < 0 || mVal > 59) {
     if ((hInput === '' || hInput === null) && (mInput === '' || mInput === null) && timePoint.period) {
        return `12:00 ${timePoint.period}`; // Default to 12:00 if only period is set
     }
     // This path should ideally not be hit if editor validation is correct
     // console.warn("formatTimePointToString: Invalid time point values for formatting", timePoint);
     return null; 
  }
  
  return `${String(hVal).padStart(2, '0')}:${String(mVal).padStart(2, '0')} ${timePoint.period}`;
};


export default function ToDoListPage() {
  const [items, setItems] = useLocalStorage<ToDoListItem[]>(LOCALSTORAGE_KEYS.TODO_LIST, []);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState('');
  
  const [editingTimeItemId, setEditingTimeItemId] = useState<string | null>(null);
  const [currentEditorTimeSettingType, setCurrentEditorTimeSettingType] = useState<TimeSettingType>('not_set');
  const [currentEditorStartTime, setCurrentEditorStartTime] = useState<TimePoint | null>(null);
  const [currentEditorEndTime, setCurrentEditorEndTime] = useState<TimePoint | null>(null);
  const [currentEditorDueDate, setCurrentEditorDueDate] = useState<Date | undefined>(undefined);

  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<string>("default");
  const { toast } = useToast();

  const [isClient, setIsClient] = useState(false);

  // State for inline voice input for tasks
  const [isListeningForTaskInput, setIsListeningForTaskInput] = useState(false);
  const [taskInputMicPermission, setTaskInputMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const recognitionTaskRef = useRef<SpeechRecognition | null>(null);
  const pauseTaskTimeoutRef = useRef<NodeJS.Timeout | null>(null);


  // State for page-level "Heggles" wake word detection
  const [isListeningForPageWakeWord, setIsListeningForPageWakeWord] = useState(false);
  const [pageWakeWordMicPermission, setPageWakeWordMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const pageWakeWordRecognitionRef = useRef<SpeechRecognition | null>(null);
  const pageWakeWordListenerShouldBeActive = useRef(true);


  useEffect(() => {
    setIsClient(true);
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setTaskInputMicPermission('unsupported');
      setPageWakeWordMicPermission('unsupported');
    } else {
        if (pageWakeWordMicPermission === 'prompt') {
             navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    stream.getTracks().forEach(track => track.stop()); // Release the stream
                    setPageWakeWordMicPermission('granted');
                })
                .catch(() => {
                    setPageWakeWordMicPermission('denied');
                });
        }
    }
    return () => { // Cleanup for task input mic
      if (recognitionTaskRef.current && recognitionTaskRef.current.stop) {
        try { recognitionTaskRef.current.stop(); } catch (e) { console.warn("Error stopping task recognition on unmount:", e); }
      }
      if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
      }
      recognitionTaskRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // pageWakeWordMicPermission removed to avoid re-prompt if denied then page re-navigated

  const handleAddItem = (e: FormEvent) => {
    e.preventDefault();
    if (!newItemText.trim()) {
      toast({ title: "Task cannot be empty", variant: "destructive" });
      return;
    }
    setItems(prevItems => [...prevItems, { 
      id: crypto.randomUUID(), 
      text: newItemText.trim(), 
      completed: false, 
      timeSettingType: 'not_set',
      startTime: null,
      endTime: null,
      dueDate: null
    }]);
    setNewItemText('');
    toast({ title: "Task Added", description: `"${newItemText.trim()}" added to your to-do list.` });
  };

  const handleDeleteItem = (id: string) => {
    const itemToDelete = items.find(item => item.id === id);
    setItems(items.filter(item => item.id !== id));
    if (itemToDelete) {
      toast({ title: "Task Deleted", description: `"${itemToDelete.text}" removed from your to-do list.` });
    }
  };

  const handleToggleComplete = (id: string) => {
    setItems(items.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
    if (editingTimeItemId === id || editingItemId === id) {
      setEditingTimeItemId(null);
      setEditingItemId(null);
    }
  };

  const handleStartEdit = (item: ToDoListItem) => {
    if (item.completed) return;
    setEditingItemId(item.id);
    setEditingItemText(item.text);
    setEditingTimeItemId(null); 
  };

  const handleSaveEdit = () => {
    if (!editingItemText.trim()) {
      toast({ title: "Task cannot be empty", variant: "destructive" });
      return;
    }
    setItems(items.map(item => item.id === editingItemId ? { ...item, text: editingItemText.trim() } : item));
    toast({ title: "Task Updated" });
    setEditingItemId(null);
    setEditingItemText('');
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setEditingItemText('');
  };

  const handleOpenTimeEditor = (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item || item.completed) return;
    setEditingTimeItemId(itemId);
    setCurrentEditorTimeSettingType(item.timeSettingType || 'not_set');
    setCurrentEditorStartTime(item.startTime ? {...item.startTime} : null); 
    setCurrentEditorEndTime(item.endTime ? {...item.endTime} : null);     
    setCurrentEditorDueDate(item.dueDate ? parseISO(item.dueDate) : undefined);
    setEditingItemId(null); // Close text editor if open
  };
  

  const handleSaveTimeSettings = () => {
    if (!editingTimeItemId) return;

    let newStartTime: TimePoint | null = null;
    let newEndTime: TimePoint | null = null;
    let finalTimeSettingType = currentEditorTimeSettingType;

    if (currentEditorTimeSettingType === 'specific_start' || currentEditorTimeSettingType === 'specific_start_end') {
        if (currentEditorStartTime) { // Check if start time object exists
            const hVal = (currentEditorStartTime.hh === '' || currentEditorStartTime.hh === null) ? 12 : parseInt(currentEditorStartTime.hh, 10);
            const mVal = (currentEditorStartTime.mm === '' || currentEditorStartTime.mm === null) ? 0 : parseInt(currentEditorStartTime.mm, 10);

            if (isNaN(hVal) || hVal < 1 || hVal > 12 || isNaN(mVal) || mVal < 0 || mVal > 59) {
                 if (!( (currentEditorStartTime.hh === '' || currentEditorStartTime.hh === null) && 
                        (currentEditorStartTime.mm === '' || currentEditorStartTime.mm === null) &&
                        currentEditorStartTime.period) ) { // Allow if hh/mm blank but period set
                    toast({ title: "Invalid Start Time", description: "Start time hours (1-12) or minutes (00-59) are invalid.", variant: "destructive" });
                    return;
                 }
            }
            if (currentEditorStartTime.period) {
                 newStartTime = { hh: String(hVal).padStart(2,'0'), mm: String(mVal).padStart(2,'0'), period: currentEditorStartTime.period };
            } else if (currentEditorStartTime.hh || currentEditorStartTime.mm) { 
                // This case is less likely if period defaults or is always part of TimePoint
                toast({ title: "Missing AM/PM", description: "Please select AM or PM for the start time.", variant: "destructive" });
                return;
            } // If no period and no hh/mm, newStartTime remains null
        }
        if (!newStartTime && currentEditorTimeSettingType === 'specific_start') finalTimeSettingType = 'not_set';
    }

    if (currentEditorTimeSettingType === 'specific_start_end') {
        if (currentEditorEndTime) { // Check if end time object exists
            const hVal = (currentEditorEndTime.hh === '' || currentEditorEndTime.hh === null) ? 12 : parseInt(currentEditorEndTime.hh, 10);
            const mVal = (currentEditorEndTime.mm === '' || currentEditorEndTime.mm === null) ? 0 : parseInt(currentEditorEndTime.mm, 10);

            if (isNaN(hVal) || hVal < 1 || hVal > 12 || isNaN(mVal) || mVal < 0 || mVal > 59) {
                 if (!( (currentEditorEndTime.hh === '' || currentEditorEndTime.hh === null) && 
                        (currentEditorEndTime.mm === '' || currentEditorEndTime.mm === null) &&
                        currentEditorEndTime.period) ) {
                    toast({ title: "Invalid End Time", description: "End time hours (1-12) or minutes (00-59) are invalid.", variant: "destructive" });
                    return;
                }
            }
             if (currentEditorEndTime.period) {
                newEndTime = { hh: String(hVal).padStart(2,'0'), mm: String(mVal).padStart(2,'0'), period: currentEditorEndTime.period };
            } else if (currentEditorEndTime.hh || currentEditorEndTime.mm) {
                toast({ title: "Missing AM/PM", description: "Please select AM or PM for the end time.", variant: "destructive" });
                return;
            } // If no period and no hh/mm, newEndTime remains null
        }

        if (!newStartTime && !newEndTime) finalTimeSettingType = 'not_set';
        else if (newStartTime && !newEndTime) finalTimeSettingType = 'specific_start';
        // If !newStartTime and newEndTime, we could clear newEndTime and set to not_set, or error.
        // Current logic allows saving just end time if start was cleared and type is still start_end,
        // it will effectively save it as 'not_set' if start becomes null.
        // Let's refine: if specific_start_end is chosen, both are required or it degrades.
        if (currentEditorTimeSettingType === 'specific_start_end' && (!newStartTime || !newEndTime)) {
             if (newStartTime && !newEndTime) finalTimeSettingType = 'specific_start';
             else if (!newStartTime && newEndTime) { newEndTime = null; finalTimeSettingType = 'not_set';} // Or specific_end if we had that type
             else finalTimeSettingType = 'not_set';
        }
    }
    
    // Handle AM/PM period types (which imply a default 12:00 time if specific times aren't set)
    if (currentEditorTimeSettingType === 'am_period' && !newStartTime) newStartTime = { hh: '12', mm: '00', period: 'AM' };
    if (currentEditorTimeSettingType === 'pm_period' && !newStartTime) newStartTime = { hh: '12', mm: '00', period: 'PM' };


    setItems(items.map(item => {
      if (item.id === editingTimeItemId) {
        return { 
          ...item, 
          timeSettingType: finalTimeSettingType,
          startTime: (finalTimeSettingType === 'not_set' || finalTimeSettingType === 'all_day') ? null : newStartTime,
          endTime: finalTimeSettingType === 'specific_start_end' ? newEndTime : null,
          dueDate: currentEditorDueDate ? format(currentEditorDueDate, 'yyyy-MM-dd') : null,
        };
      }
      return item;
    }));
    toast({ title: "Time & Date Settings Saved" });
    setEditingTimeItemId(null);
  };
  
  const handleClearTimeSettings = () => {
    if (!editingTimeItemId) return;
     setItems(items.map(item => {
      if (item.id === editingTimeItemId) {
        return { 
          ...item, 
          timeSettingType: 'not_set',
          startTime: null,
          endTime: null,
          dueDate: null,
        };
      }
      return item;
    }));
    toast({ title: "Time & Date Settings Cleared" });
    setEditingTimeItemId(null); 
  };

  const handleCancelTimeEditor = () => {
    setEditingTimeItemId(null);
  };
  
  const handleTempTimeChange = (type: 'start' | 'end', field: 'hh' | 'mm' | 'period', value: string) => {
    const setter = type === 'start' ? setCurrentEditorStartTime : setCurrentEditorEndTime;
    setter(prev => {
      // Ensure prev is not null; if it is, initialize with initialTimePoint
      const baseTimePoint = prev || { ...initialTimePoint };
      const newPoint = { ...baseTimePoint, [field]: value };

      if (field === 'hh' && value === '') newPoint.hh = ''; // Allow clearing
      if (field === 'mm' && value === '') newPoint.mm = ''; // Allow clearing
      return newPoint;
    });
  };

  const displayFormattedTime = (item: ToDoListItem): string => {
    if (!item.timeSettingType || item.timeSettingType === 'not_set') return 'No time set';
    if (item.timeSettingType === 'all_day') return 'All Day';
    if (item.timeSettingType === 'am_period') return 'AM';
    if (item.timeSettingType === 'pm_period') return 'PM';
    
    let displayStr = "";
    if (item.startTime) {
      const formattedStart = formatTimePointToString(item.startTime);
      if (formattedStart) displayStr += `Starts ${formattedStart}`;
      else if (item.timeSettingType === 'specific_start' || item.timeSettingType === 'specific_start_end') {
          // Handle case where TimePoint exists but might be invalid for formatting (e.g. only period)
          if(item.startTime.period && !item.startTime.hh && !item.startTime.mm) {
             displayStr += `Starts ~${item.startTime.period}`;
          } else {
            displayStr += 'Invalid start time';
          }
      }
    }
    if (item.timeSettingType === 'specific_start_end' && item.endTime) {
      const formattedEnd = formatTimePointToString(item.endTime);
       if (formattedEnd) displayStr += displayStr ? ` - Ends ${formattedEnd}` : `Ends ${formattedEnd}`;
       else if (item.endTime.period && !item.endTime.hh && !item.endTime.mm) {
            displayStr += displayStr ? ` - Ends ~${item.endTime.period}` : `Ends ~${item.endTime.period}`;
       } else {
            displayStr += displayStr ? ' - Invalid end time' : 'Invalid end time';
       }
    }
    return displayStr || (item.timeSettingType !== 'not_set' ? 'Time set (check details)' : 'No time set');
  };
  
  const displayDueDate = (dueDate: string | null | undefined): React.ReactNode => {
    if (!dueDate) return <span className="text-muted-foreground italic">No due date</span>;
    try {
      const dateObj = parseISO(dueDate);
      if (!isValid(dateObj)) return <span className="text-red-500">Invalid date</span>;
      
      const formatted = format(dateObj, 'dd/MM/yyyy');
      let classes = "font-medium";
      let icon = null;

      if (isPast(dateObj) && !isToday(dateObj)) {
        classes = "text-red-600 dark:text-red-400 font-bold";
        icon = <AlertTriangle className="h-4 w-4 mr-1 inline-block" />;
      } else if (isToday(dateObj)) {
        classes = "text-orange-600 dark:text-orange-400 font-semibold";
        icon = <Clock className="h-4 w-4 mr-1 inline-block" />;
      } else if (isTomorrow(dateObj)) {
        classes = "text-yellow-600 dark:text-yellow-400";
        icon = <Clock className="h-4 w-4 mr-1 inline-block" />;
      }
      return <span className={classes}>{icon}{formatted}</span>;
    } catch {
      return <span className="text-red-500">Error parsing date</span>;
    }
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    if (sortOrder !== 'default') {
      toast({title: "Reordering Disabled", description: "Manual reordering is disabled when a sort order is active. Set sort to 'Default Order' to reorder.", variant:"default"});
      return;
    }
    const newItems = [...items];
    const itemToMove = newItems[index];
    if (direction === 'up' && index > 0) {
      newItems.splice(index, 1);
      newItems.splice(index - 1, 0, itemToMove);
    } else if (direction === 'down' && index < newItems.length - 1) {
      newItems.splice(index, 1);
      newItems.splice(index + 1, 0, itemToMove);
    }
    setItems(newItems);
  };

  const handleDragStart = (id: string) => {
    if (sortOrder !== 'default') return;
    setDraggedItemId(id);
  };

  const handleDragOver = (event: DragEvent<HTMLLIElement>) => {
    if (sortOrder !== 'default') return;
    event.preventDefault(); 
  };

  const handleDrop = (targetItemId: string) => {
    if (sortOrder !== 'default') {
      setDraggedItemId(null);
      return;
    }
    if (!draggedItemId || draggedItemId === targetItemId) {
      setDraggedItemId(null);
      return;
    }
    const newItems = [...items];
    const draggedItemIndex = newItems.findIndex(item => item.id === draggedItemId);
    const targetItemIndex = newItems.findIndex(item => item.id === targetItemId);
    if (draggedItemIndex === -1 || targetItemIndex === -1) {
      setDraggedItemId(null);
      return;
    }
    const [draggedItem] = newItems.splice(draggedItemIndex, 1);
    newItems.splice(targetItemIndex, 0, draggedItem);
    setItems(newItems);
    setDraggedItemId(null);
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
  };

  const sortedItems = useMemo(() => {
    let displayItems = [...items]; // Use a mutable copy for sorting
    const defaultSortedItems = [...items]; // Keep a reference to original order for tie-breaking

    switch (sortOrder) {
      case 'dueDateAsc':
        displayItems.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return defaultSortedItems.findIndex(item => item.id === a.id) - defaultSortedItems.findIndex(item => item.id === b.id);
          if (!a.dueDate) return 1; 
          if (!b.dueDate) return -1;
          const dateDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          return defaultSortedItems.findIndex(item => item.id === a.id) - defaultSortedItems.findIndex(item => item.id === b.id);
        });
        break;
      case 'dueDateDesc':
        displayItems.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return defaultSortedItems.findIndex(item => item.id === a.id) - defaultSortedItems.findIndex(item => item.id === b.id);
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          const dateDiff = new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          return defaultSortedItems.findIndex(item => item.id === a.id) - defaultSortedItems.findIndex(item => item.id === b.id);
        });
        break;
      case 'alphaAsc':
        displayItems.sort((a, b) => a.text.localeCompare(b.text));
        break;
      case 'alphaDesc':
        displayItems.sort((a, b) => b.text.localeCompare(a.text));
        break;
      case 'priority':
        displayItems.sort((a, b) => {
          const aHasDueDate = !!a.dueDate;
          const bHasDueDate = !!b.dueDate;

          if (aHasDueDate && !bHasDueDate) return -1; 
          if (!aHasDueDate && bHasDueDate) return 1;  
          
          if (aHasDueDate && bHasDueDate) { 
            const dateA = new Date(a.dueDate!).getTime();
            const dateB = new Date(b.dueDate!).getTime();
            if (dateA !== dateB) {
              return dateA - dateB; 
            }
          }
          const indexA = defaultSortedItems.findIndex(item => item.id === a.id); 
          const indexB = defaultSortedItems.findIndex(item => item.id === b.id); 
          return indexA - indexB;
        });
        break;
      case 'default':
      default:
        // displayItems remains items (which is already in default order due to useLocalStorage)
        break;
    }
    return displayItems;
  }, [items, sortOrder]);

  const startTaskInputRecognition = useCallback(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || taskInputMicPermission !== 'granted') return;

    if (recognitionTaskRef.current && recognitionTaskRef.current.stop) {
      try { recognitionTaskRef.current.stop(); } catch(e) { /* ignore */ }
    }
    if (pauseTaskTimeoutRef.current) {
      clearTimeout(pauseTaskTimeoutRef.current);
    }

    const recognition = new SpeechRecognitionAPI();
    recognitionTaskRef.current = recognition;
    recognition.continuous = true; // Listen continuously
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListeningForTaskInput(true);
    recognition.onresult = (event: SpeechRecognitionEvent) => {
       if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
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
        if (recognitionTaskRef.current) {
          try { recognitionTaskRef.current.stop(); } catch(e) { /* ignore */ }
        }
      } else {
        setNewItemText(transcript);
        pauseTaskTimeoutRef.current = setTimeout(() => {
          if (recognitionTaskRef.current) {
            try { recognitionTaskRef.current.stop(); } catch(e) { /* ignore */ }
          }
        }, 2000); // 2-second pause
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Task input speech recognition error:', event.error, event.message);
      if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
      }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setTaskInputMicPermission('denied');
        toast({ title: "Microphone Access Denied", variant: "destructive" });
      } else if (event.error === 'no-speech' && !isListeningForTaskInput) {
        // Do nothing specific if it's just a timeout and we weren't actively showing listening state
      } else if (event.error === 'no-speech') {
        toast({ title: "No speech detected", variant: "default" });
      }
       else {
        toast({ title: "Voice Input Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsListeningForTaskInput(false);
    };
    recognition.onend = () => {
      setIsListeningForTaskInput(false);
      if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
      }
      recognitionTaskRef.current = null; // Important for re-initialization
      pageWakeWordListenerShouldBeActive.current = true; 
    };
    
    setNewItemText('');
    recognition.start();
  }, [taskInputMicPermission, toast, isListeningForTaskInput]);


  const triggerTaskInputMic = useCallback(async () => {
    if (isListeningForTaskInput) {
      if (recognitionTaskRef.current?.stop) {
         try { recognitionTaskRef.current.stop(); } catch(e) {/* ignore */}
      }
       if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
      }
      setIsListeningForTaskInput(false);
      return;
    }

    if (taskInputMicPermission === 'unsupported') {
      toast({ title: "Voice input not supported", variant: "destructive" });
      return;
    }
    if (taskInputMicPermission === 'denied') {
      toast({ title: "Microphone Access Denied", variant: "destructive" });
      return;
    }

    let currentPermission = taskInputMicPermission;
    if (taskInputMicPermission === 'prompt') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setTaskInputMicPermission('granted');
        currentPermission = 'granted';
      } catch (err) {
        setTaskInputMicPermission('denied');
        toast({ title: "Microphone Access Denied", variant: "destructive" });
        return;
      }
    }
    
    if (currentPermission === 'granted') {
      pageWakeWordListenerShouldBeActive.current = false; 
      if (pageWakeWordRecognitionRef.current?.stop) {
         try { pageWakeWordRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      startTaskInputRecognition();
    }
  }, [isListeningForTaskInput, taskInputMicPermission, startTaskInputRecognition, toast]);

  useEffect(() => {
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI || pageWakeWordMicPermission !== 'granted' || isListeningForTaskInput || !pageWakeWordListenerShouldBeActive.current) {
      if (pageWakeWordRecognitionRef.current?.stop) {
        try { pageWakeWordRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      return;
    }

    if (!pageWakeWordRecognitionRef.current) {
      const pageRecognition = new SpeechRecognitionAPI();
      pageWakeWordRecognitionRef.current = pageRecognition;
      pageRecognition.continuous = true; // Keep listening for wake word
      pageRecognition.interimResults = false; // Only final results for wake word
      pageRecognition.lang = 'en-US';

      pageRecognition.onstart = () => setIsListeningForPageWakeWord(true);
      pageRecognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
         const detectedWakeWord = transcript === WAKE_WORDS.HEGGLES_BASE.toLowerCase() 
          ? WAKE_WORDS.HEGGLES_BASE 
          : null; // Only listen for Heggles now

        if (detectedWakeWord) {
          toast({ title: `'${detectedWakeWord.charAt(0).toUpperCase() + detectedWakeWord.slice(1)}' Detected`, description: "Activating task input microphone..." });
          pageWakeWordListenerShouldBeActive.current = false;
          if (pageWakeWordRecognitionRef.current?.stop) { // Stop page wake word listener
            try { pageWakeWordRecognitionRef.current.stop(); } catch(e) {/* ignore */}
          }
          triggerTaskInputMic(); // Activate task input mic
        }
      };
      pageRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Page Wake Word recognition error:', event.error, event.message);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setPageWakeWordMicPermission('denied');
        } else if (event.error === 'no-speech' && isListeningForPageWakeWord) {
            // Continuous listening often gets these; let it be, it might restart or onend will handle.
        }
        // No setIsListeningForPageWakeWord(false) for 'no-speech' with continuous true
        // onend handles setting ref to null to allow restart by useEffect
      };
      pageRecognition.onend = () => {
        setIsListeningForPageWakeWord(false); // Always set to false on end.
        pageWakeWordRecognitionRef.current = null; // Allow re-initialization by useEffect
      };
      
      try {
        if (pageWakeWordListenerShouldBeActive.current) pageRecognition.start();
      } catch (e) {
        console.error("Failed to start page Wake Word recognition:", e);
        setIsListeningForPageWakeWord(false);
        pageWakeWordRecognitionRef.current = null;
      }
    }
    
    return () => { // Cleanup for page wake word listener
      if (pageWakeWordRecognitionRef.current?.stop) {
         try { pageWakeWordRecognitionRef.current.stop(); } catch(e) {/* ignore */}
      }
      pageWakeWordRecognitionRef.current = null;
      setIsListeningForPageWakeWord(false);
    };
  }, [pageWakeWordMicPermission, isListeningForTaskInput, triggerTaskInputMic, toast, isListeningForPageWakeWord]);


  if (!isClient) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <ClipboardList className="h-16 w-16 animate-pulse text-primary" />
      </div>
    );
  }

  const renderTimePointInput = (type: 'start' | 'end', timePoint: TimePoint | null) => {
    const currentVal = type === 'start' ? currentEditorStartTime : currentEditorEndTime;
    return (
      <div className="flex items-center gap-1 p-1 border rounded-md bg-background">
        <Input type="text" value={currentVal?.hh || ''} onChange={(e) => handleTempTimeChange(type, 'hh', e.target.value)} maxLength={2} className="w-12 h-8 text-center px-0.5 text-sm" placeholder="HH"/>:
        <Input type="text" value={currentVal?.mm || ''} onChange={(e) => handleTempTimeChange(type, 'mm', e.target.value)} maxLength={2} className="w-12 h-8 text-center px-0.5 text-sm" placeholder="MM"/>
        <Select value={currentVal?.period || (type === 'start' ? 'AM' : 'PM')} onValueChange={(val) => handleTempTimeChange(type, 'period', val as 'AM' | 'PM')}>
          <SelectTrigger className="w-20 h-8 px-2 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent>
        </Select>
      </div>
    );
  };

  const taskMicButtonDisabled = taskInputMicPermission === 'unsupported' || taskInputMicPermission === 'denied';
  const pageWakeWordStatusText = isListeningForPageWakeWord ? "Listening for 'Heggles'..." : (pageWakeWordMicPermission === 'granted' && pageWakeWordListenerShouldBeActive.current ? "Say 'Heggles' to activate input" : "Page Wake Word listener off");


  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-10 w-10 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">To-Do List</h1>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
            <p className="text-xs text-muted-foreground flex-grow sm:flex-grow-0 text-right sm:text-left">
                {pageWakeWordMicPermission === 'granted' && !isListeningForTaskInput ? pageWakeWordStatusText : ""}
            </p>
            <Select value={sortOrder} onValueChange={setSortOrder}>
                <SelectTrigger className="w-full sm:w-[200px]" aria-label="Sort tasks by">
                <SelectValue placeholder="Sort by..." />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value="default">Default Order</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="dueDateAsc">Due Date (Oldest First)</SelectItem>
                <SelectItem value="dueDateDesc">Due Date (Newest First)</SelectItem>
                <SelectItem value="alphaAsc">Alphabetical (A-Z)</SelectItem>
                <SelectItem value="alphaDesc">Alphabetical (Z-A)</SelectItem>
                </SelectContent>
            </Select>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl">Add New Task</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddItem} className="flex items-center gap-2 sm:gap-3">
            <Input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="E.g., Finish report, Call John"
              className="flex-grow"
              aria-label="New to-do list item"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={triggerTaskInputMic}
              disabled={taskMicButtonDisabled && taskInputMicPermission !== 'prompt'}
              title={taskMicButtonDisabled && taskInputMicPermission !== 'prompt' ? "Voice input unavailable" : (isListeningForTaskInput ? "Stop voice input (or say 'Heggles end')" : "Add task using voice")}
              aria-label="Add task using voice"
            >
              {isListeningForTaskInput ? <Mic className="h-5 w-5 text-primary animate-pulse" /> :
               (taskMicButtonDisabled ? <MicOff className="h-5 w-5 text-muted-foreground" /> : <Mic className="h-5 w-5" />)}
            </Button>
            <Button type="submit" aria-label="Add task" className="px-3 sm:px-4">
              <PlusCircle className="mr-0 sm:mr-2 h-5 w-5" />
               <span className="hidden sm:inline">Add Task</span>
            </Button>
          </form>
        </CardContent>
      </Card>

      {sortedItems.length > 0 ? (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">Your Tasks ({sortedItems.filter(i => !i.completed).length} pending)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {sortedItems.map((item, index) => (
                <li
                  key={item.id}
                  draggable={!item.completed && sortOrder === 'default'}
                  onDragStart={() => handleDragStart(item.id)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(item.id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "p-4 rounded-lg transition-all flex flex-col gap-3",
                    item.completed ? 'bg-muted/50 opacity-70' : 'bg-card-foreground/5 hover:bg-card-foreground/10',
                    draggedItemId === item.id && !item.completed && sortOrder === 'default' ? 'opacity-50 border-2 border-dashed border-primary' : ''
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!item.completed && sortOrder === 'default' && (
                      <GripVertical className="h-5 w-5 text-muted-foreground self-center shrink-0 cursor-grab" />
                    )}
                    {(item.completed || sortOrder !== 'default') && (
                      <div className="w-5 shrink-0"></div> 
                    )}
                    <span className="pt-1 mr-1 font-medium text-muted-foreground w-6 text-right self-start shrink-0">{(index + 1)}.</span>
                    <Checkbox
                      id={`task-${item.id}`}
                      checked={item.completed}
                      onCheckedChange={() => handleToggleComplete(item.id)}
                      aria-labelledby={`task-text-${item.id}`}
                      className="mt-1 self-start shrink-0"
                    />
                    <div className="flex-grow space-y-1">
                      {editingItemId === item.id && !item.completed ? (
                        <Input
                          type="text"
                          value={editingItemText}
                          onChange={(e) => setEditingItemText(e.target.value)}
                          onBlur={handleSaveEdit} 
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                          autoFocus
                          className="h-9"
                          aria-label="Edit task text"
                        />
                      ) : (
                        <span
                          id={`task-text-${item.id}`}
                          className={`block ${!item.completed ? 'cursor-pointer' : ''} ${item.completed ? 'line-through text-muted-foreground' : ''}`}
                          onClick={() => !item.completed && handleStartEdit(item)}
                          title={!item.completed ? "Click to edit" : ""}
                        >
                          {item.text}
                        </span>
                      )}
                       <div className="text-xs text-muted-foreground">
                        <span className="flex items-center"><Clock className="h-3 w-3 mr-1"/> {displayFormattedTime(item)}</span>
                        <span className="flex items-center mt-0.5"><CalendarIcon className="h-3 w-3 mr-1"/> {displayDueDate(item.dueDate)}</span>
                      </div>
                    </div>
                     <div className="flex flex-col items-center gap-0.5 self-start shrink-0">
                       {editingItemId === item.id && !item.completed ? (
                        <>
                          <Button variant="ghost" size="icon" onClick={handleSaveEdit} title="Save changes" className="h-7 w-7">
                            <Save className="h-4 w-4 text-green-600" />
                          </Button>
                           <Button variant="ghost" size="icon" onClick={handleCancelEdit} title="Cancel editing" className="h-7 w-7">
                            <Ban className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </>
                      ) : (
                        <>
                          {!item.completed && (
                            <Button variant="ghost" size="icon" onClick={() => handleStartEdit(item)} title="Edit task text" className="h-7 w-7">
                              <Edit3 className="h-4 w-4 text-blue-600" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteItem(item.id)} title="Delete task" className="h-7 w-7">
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      )}
                      {!item.completed && sortOrder === 'default' && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => handleMoveItem(items.findIndex(i => i.id === item.id), 'up')} disabled={sortedItems.findIndex(i => i.id === item.id) === 0} title="Move up" className="h-7 w-7">
                            <ChevronUp className="h-5 w-5" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleMoveItem(items.findIndex(i => i.id === item.id), 'down')} disabled={sortedItems.findIndex(i => i.id === item.id) === sortedItems.length - 1} title="Move down" className="h-7 w-7">
                            <ChevronDown className="h-5 w-5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {!item.completed && (
                    <div className="pl-8"> 
                       <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full text-xs h-8"
                          onClick={() => editingTimeItemId === item.id ? setEditingTimeItemId(null) : handleOpenTimeEditor(item.id)}
                        >
                          {editingTimeItemId === item.id ? 'Close Time/Date Editor' : 'Manage Time & Due Date'}
                       </Button>

                      {editingTimeItemId === item.id && (
                        <div className="mt-3 p-3 border rounded-md bg-background space-y-4">
                          <div>
                            <Label className="text-xs font-medium">Time Setting Type</Label>
                            <Select value={currentEditorTimeSettingType} onValueChange={(val) => setCurrentEditorTimeSettingType(val as TimeSettingType)}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="not_set">Not Set</SelectItem>
                                <SelectItem value="all_day">All Day</SelectItem>
                                <SelectItem value="am_period">AM</SelectItem>
                                <SelectItem value="pm_period">PM</SelectItem>
                                <SelectItem value="specific_start">Starts At</SelectItem>
                                <SelectItem value="specific_start_end">Time Range</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {(currentEditorTimeSettingType === 'specific_start' || currentEditorTimeSettingType === 'specific_start_end') && (
                            <div>
                              <Label className="text-xs font-medium">Start Time</Label>
                              {renderTimePointInput('start', currentEditorStartTime)}
                            </div>
                          )}
                          {currentEditorTimeSettingType === 'specific_start_end' && (
                             <div>
                              <Label className="text-xs font-medium">End Time</Label>
                              {renderTimePointInput('end', currentEditorEndTime)}
                            </div>
                          )}
                          
                          <div>
                            <Label className="text-xs font-medium">Due Date</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full justify-start text-left font-normal h-9 text-sm",
                                    !currentEditorDueDate && "text-muted-foreground"
                                  )}
                                >
                                  <CalendarIcon className="mr-2 h-4 w-4" />
                                  {currentEditorDueDate ? format(currentEditorDueDate, "dd/MM/yyyy") : <span>Pick a date</span>}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0">
                                <Calendar
                                  mode="single"
                                  selected={currentEditorDueDate}
                                  onSelect={setCurrentEditorDueDate}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>

                          <div className="flex gap-2 justify-end pt-2">
                            <Button variant="ghost" size="sm" onClick={handleCancelTimeEditor}>Cancel</Button>
                            <Button variant="outline" size="sm" onClick={handleClearTimeSettings}>Clear All</Button>
                            <Button size="sm" onClick={handleSaveTimeSettings}><Save className="mr-1.5 h-4 w-4"/>Save Settings</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center py-12">
          <CheckSquare className="mx-auto h-16 w-16 text-muted-foreground mb-6 opacity-50" />
          <h3 className="text-2xl font-semibold">Your To-Do List is Empty</h3>
          <p className="text-muted-foreground mt-2">Add tasks using the form above to get started.</p>
        </div>
      )}
    </div>
  );
}

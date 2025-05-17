
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
import { format, parseISO, isValid, isPast, isToday, isTomorrow, parse } from 'date-fns';
import { 
  ClipboardList, Trash2, Edit3, PlusCircle, Save, Ban, CheckSquare, Clock, 
  ChevronUp, ChevronDown, GripVertical, CalendarIcon, AlertTriangle, Mic, MicOff 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LOCALSTORAGE_KEYS, WAKE_WORDS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';

const initialTimePoint: TimePoint = { hh: '12', mm: '00', period: 'AM' };

const formatTimePointToString = (timePoint?: TimePoint | null): string | null => {
  if (!timePoint || !timePoint.period) return null; 
  const hInput = timePoint.hh;
  const mInput = timePoint.mm; 

  const hVal = (hInput === '' || hInput === null) ? 12 : parseInt(hInput, 10);
  const mVal = (mInput === '' || mInput === null) ? 0 : parseInt(mInput, 10);

  if (isNaN(hVal) || hVal < 1 || hVal > 12 || isNaN(mVal) || mVal < 0 || mVal > 59) {
     if ((hInput === '' || hInput === null) && (mInput === '' || mInput === null) && timePoint.period) {
        return `12:00 ${timePoint.period}`; 
     }
     return null; 
  }
  
  return `${String(hVal).padStart(2, '0')}:${String(mVal).padStart(2, '0')} ${timePoint.period}`;
};


export default function ToDoListPage() {
  const [items, setItems] = useLocalStorage<ToDoListItem[]>(LOCALSTORAGE_KEYS.TODO_LIST, []);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState('');
  
  const [exportFormat, setExportFormat] = useState<'csv' | 'excel' | 'json' | 'text'>('csv');
  const [importFormat, setImportFormat] = useState<'csv' | 'excel' | 'json' | 'text'>('csv');

  const [editingTimeItemId, setEditingTimeItemId] = useState<string | null>(null);
  const [currentEditorTimeSettingType, setCurrentEditorTimeSettingType] = useState<TimeSettingType>('not_set');
  const [currentEditorStartTime, setCurrentEditorStartTime] = useState<TimePoint | null>(null);
  const [currentEditorEndTime, setCurrentEditorEndTime] = useState<TimePoint | null>(null);
  const [currentEditorDueDate, setCurrentEditorDueDate] = useState<Date | undefined>(undefined);

  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<string>("default");
  const { toast } = useToast();

  const [isClient, setIsClient] = useState(false);

  const [isListeningForTaskInput, setIsListeningForTaskInput] = useState(false);
  const [taskInputMicPermission, setTaskInputMicPermission] = useState<'prompt' | 'granted' | 'denied' | 'unsupported'>('prompt');
  const recognitionTaskRef = useRef<SpeechRecognition | null>(null);
  const pauseTaskTimeoutRef = useRef<NodeJS.Timeout | null>(null);


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
                    stream.getTracks().forEach(track => track.stop()); 
                    setPageWakeWordMicPermission('granted');
                })
                .catch(() => {
                    setPageWakeWordMicPermission('denied');
                });
        }
    }
    return () => { 
      if (recognitionTaskRef.current && recognitionTaskRef.current.stop) {
        try { recognitionTaskRef.current.stop(); } catch (e) { /* ignore */ }
      }
      if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
      }
      recognitionTaskRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

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
    setEditingItemId(null); 
  };
  

  const handleSaveTimeSettings = () => {
    if (!editingTimeItemId) return;

    let newStartTime: TimePoint | null = null;
    let newEndTime: TimePoint | null = null;
    let finalTimeSettingType = currentEditorTimeSettingType;

    if (currentEditorTimeSettingType === 'specific_start' || currentEditorTimeSettingType === 'specific_start_end') {
        if (currentEditorStartTime) { 
            const hVal = (currentEditorStartTime.hh === '' || currentEditorStartTime.hh === null) ? 12 : parseInt(currentEditorStartTime.hh, 10);
            const mVal = (currentEditorStartTime.mm === '' || currentEditorStartTime.mm === null) ? 0 : parseInt(currentEditorStartTime.mm, 10);

            if (isNaN(hVal) || hVal < 1 || hVal > 12 || isNaN(mVal) || mVal < 0 || mVal > 59) {
                 if (!( (currentEditorStartTime.hh === '' || currentEditorStartTime.hh === null) && 
                        (currentEditorStartTime.mm === '' || currentEditorStartTime.mm === null) &&
                        currentEditorStartTime.period) ) { 
                    toast({ title: "Invalid Start Time", description: "Start time hours (1-12) or minutes (00-59) are invalid.", variant: "destructive" });
                    return;
                 }
            }
            if (currentEditorStartTime.period) {
                 newStartTime = { hh: String(hVal).padStart(2,'0'), mm: String(mVal).padStart(2,'0'), period: currentEditorStartTime.period };
            } else if (currentEditorStartTime.hh || currentEditorStartTime.mm) { 
                toast({ title: "Missing AM/PM", description: "Please select AM or PM for the start time.", variant: "destructive" });
                return;
            } 
        }
        if (!newStartTime && currentEditorTimeSettingType === 'specific_start') finalTimeSettingType = 'not_set';
    }

    if (currentEditorTimeSettingType === 'specific_start_end') {
        if (currentEditorEndTime) { 
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
            } 
        }

        if (!newStartTime && !newEndTime) finalTimeSettingType = 'not_set';
        else if (newStartTime && !newEndTime) finalTimeSettingType = 'specific_start';
        
        if (currentEditorTimeSettingType === 'specific_start_end' && (!newStartTime || !newEndTime)) {
             if (newStartTime && !newEndTime) finalTimeSettingType = 'specific_start';
             else if (!newStartTime && newEndTime) { newEndTime = null; finalTimeSettingType = 'not_set';} 
             else finalTimeSettingType = 'not_set';
        }
    }
    
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
      const baseTimePoint = prev || { ...initialTimePoint };
      const newPoint = { ...baseTimePoint, [field]: value };

      if (field === 'hh' && value === '') newPoint.hh = ''; 
      if (field === 'mm' && value === '') newPoint.mm = ''; 
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

  const handleExportTemplate = async () => {
    if (exportFormat === 'excel') {
      await handleExportExcelTemplate();
    } else if (exportFormat === 'text') {
      // TODO: Implement text export template logic
       toast({ title: "Export Template Failed", description: "Text template export is not yet implemented.", variant: "destructive" });
    } else { // CSV template
    const csvContent = `text,completed,timeSettingType,startTime,endTime,dueDate
# This is a CSV template for importing To-Do List items.
# Each row represents a single task.
#
# text: The description of the task (required). Use double quotes "" around text containing commas or double quotes. Double quotes within text should be escaped by doubling them (e.g., "He said ""Hello""").
# completed: Task completion status. Must be 'true' or 'false'.
# timeSettingType: The type of time setting. Accepted values: 'not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'. (Optional, default 'not_set')
# startTime: The start time of the task. Format as "hh:mm AM/PM" (e.g., "09:30 AM", "01:00 PM"). Required if timeSettingType is 'specific_start' or 'specific_start_end'. (Optional)
# endTime: The end time of the task. Format as "hh:mm AM/PM" (e.g., "11:00 AM", "05:00 PM"). Required if timeSettingType is 'specific_start_end'. (Optional)
# dueDate: The due date of the task. Format as "YYYY-MM-DD" (e.g., "2023-10-27"). (Optional)
#
# Example Rows:
# Task 1,false,specific_start,09:00 AM,,2023-11-15
# Buy groceries,true,not_set,,,
# Finish report,"false",specific_start_end,"02:00 PM","05:30 PM",2023-10-31
`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'todo-list_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "To-Do List Template Exported", description: `A ${exportFormat.toUpperCase()} template has been downloaded.` });
    }
  };

 const handleExportExcelTemplate = () => {
    const templateComments = [
      ["# This is an Excel template for importing To-Do List items."],
      ["# Each row starting from row 8 represents a single task."],
      ["#"],
      ["# Column Explanations:"],
      ["# text: The description of the task (required)."],
      ["# completed: Task completion status. Must be 'true' or 'false'."],
      ["# timeSettingType: The type of time setting. Accepted values: 'not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'. (Optional, default 'not_set')"],
      ["# startTime: The start time of the task. Format as 'HH:MM AM/PM' (e.g., '09:30 AM', '01:00 PM'). Required if timeSettingType is 'specific_start' or 'specific_start_end'. (Optional)"],
      ["# endTime: The end time of the task. Format as 'HH:MM AM/PM' (e.g., '11:00 AM', '05:00 PM'). Required if timeSettingType is 'specific_start_end'. (Optional)"],
      ["# dueDate: The due date of the task. Format as 'YYYY-MM-DD' (e.g., '2023-10-27'). (Optional)"],
      []
    ];

    const header = ["text", "completed", "timeSettingType", "startTime", "endTime", "dueDate"];

    const exampleRows = [
      ["Task 1", "false", "specific_start", "09:00 AM", "", "2023-11-15"],
      ["Buy groceries", "true", "not_set", "", "", ""],
      ["Finish report", "false", "specific_start_end", "02:00 PM", "05:30 PM", "2023-10-31"]
    ];

    const worksheetData = [...templateComments, header, ...exampleRows];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "To-Do List Template");

    // Set column widths (optional)
     worksheet['!cols'] = [
      { wch: 30 }, // text
      { wch: 10 }, // completed
      { wch: 15 }, // timeSettingType
      { wch: 10 }, // startTime
      { wch: 10 }, // endTime
      { wch: 12 }  // dueDate
    ];

    XLSX.writeFile(workbook, "todo-list_template.xlsx");
     toast({ title: "To-Do List Template Exported", description: `An Excel template has been downloaded.` });
 };



  const handleExportList = async () => {
    if (exportFormat === 'json') {
       const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(items, null, 2));
       const downloadAnchorNode = document.createElement('a');
       downloadAnchorNode.setAttribute("href", dataStr);
       downloadAnchorNode.setAttribute("download", "todo-list.json");
       document.body.appendChild(downloadAnchorNode); 
       downloadAnchorNode.click();
       downloadAnchorNode.remove();
       toast({ title: "To-Do List Exported", description: "Your list has been downloaded as a JSON file." });
    } else if (exportFormat === 'excel') {
      await handleExportExcel();
    } else if (exportFormat === 'text') {
      // TODO: Implement text export logic
      toast({ title: "Export Failed", description: "Text export is not yet implemented.", variant: "destructive" });
    } else { // CSV Export

    const headers = ["text", "completed", "timeSettingType", "startTime", "endTime", "dueDate"];
    const csvRows = items.map(item => {
      const values = [
        `"${item.text.replace(/"/g, '""')}"`, // Escape double quotes in text
        item.completed ? 'true' : 'false',
        item.timeSettingType || '',
        item.startTime ? formatTimePointToString(item.startTime) || '' : '',
        item.endTime ? formatTimePointToString(item.endTime) || '' : '',
        item.dueDate || '',
      ];
      return values.join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\\n'); // Use \\n for newline in JS string literal
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'todo-list.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "To-Do List Exported", description: "Your list has been downloaded as a CSV file." });
    }
  };

  const handleExportExcel = () => {
    const data = items.map(item => ({
      text: item.text,
      completed: item.completed ? 'true' : 'false',
      timeSettingType: item.timeSettingType || '',
      startTime: item.startTime ? formatTimePointToString(item.startTime) || '' : '',
      endTime: item.endTime ? formatTimePointToString(item.endTime) || '' : '',
      dueDate: item.dueDate || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "To-Do List");

    // Set column widths (optional)
     worksheet['!cols'] = [
      { wch: 30 }, // text
      { wch: 10 }, // completed
      { wch: 15 }, // timeSettingType
      { wch: 10 }, // startTime
      { wch: 10 }, // endTime
      { wch: 12 }  // dueDate
    ];

    // Auto-filter (optional)
    worksheet['!autofilter'] = { ref: "A1:F" + (data.length + 1) };

    // Freeze header row (optional)
    worksheet['!freeze'] = 'A2';

    XLSX.writeFile(workbook, "todo-list.xlsx");
  };

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const lines = csvText.split(/\\r?\\n/).filter(line => line.trim() !== '' && !line.trim().startsWith('#')); // Handle potential \\r and skip comments
        
        if (lines.length === 0) {
           toast({ title: "Import Failed", description: "The selected file is empty.", variant: "destructive" });
           return;
        }

        const headers = lines[0].split(',').map(h => h.trim());
        const expectedHeaders = ["text", "completed", "timeSettingType", "startTime", "endTime", "dueDate"];

         if (!expectedHeaders.every(h => headers.includes(h))) {
             toast({ title: "Import Failed", description: "Invalid CSV format. Missing required columns: " + expectedHeaders.filter(h => !headers.includes(h)).join(', '), variant: "destructive" });
             return;
         }

        const importedItems: ToDoListItem[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          const itemData: Record<string, string> = {};
          headers.forEach((header, index) => {
             let value = values[index];
             // Remove surrounding quotes if present
             if (value && value.startsWith('"') && value.endsWith('"')) {
                 value = value.substring(1, value.length - 1).replace(/""/g, '"'); // Unescape double quotes
             }
             itemData[header] = value;
          });

          const startTimeString = itemData['startTime'];
          const endTimeString = itemData['endTime'];

          importedItems.push({
            id: crypto.randomUUID(), // Always generate new IDs on import
            text: itemData['text'] || 'Unnamed Task',
            completed: itemData['completed']?.toLowerCase() === 'true',
            timeSettingType: (itemData['timeSettingType'] as TimeSettingType) || 'not_set',
            startTime: startTimeString ? (parse(startTimeString, 'hh:mm a', new Date()) ? { hh: format(parse(startTimeString, 'hh:mm a', new Date()), 'hh'), mm: format(parse(startTimeString, 'hh:mm a', new Date()), 'mm'), period: format(parse(startTimeString, 'hh:mm a', new Date()), 'a') as 'AM' | 'PM' } : null) : null,
            endTime: endTimeString ? (parse(endTimeString, 'hh:mm a', new Date()) ? { hh: format(parse(endTimeString, 'hh:mm a', new Date()), 'hh'), mm: format(parse(endTimeString, 'hh:mm a', new Date()), 'mm'), period: format(parse(endTimeString, 'hh:mm a', new Date()), 'a') as 'AM' | 'PM' } : null) : null,
            dueDate: itemData['dueDate'] && isValid(parseISO(itemData['dueDate'])) ? itemData['dueDate'] : null,
          });
        }

        setItems(importedItems);
        toast({ title: "To-Do List Imported", description: `${importedItems.length} tasks loaded from CSV.` });

      } catch (error) {
        toast({ title: "Import Failed", description: "Could not process CSV file. Please check the format.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };

  const handleImportJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonText = e.target?.result as string;
        const importedItems: ToDoListItem[] = JSON.parse(jsonText);

        // Basic validation to ensure imported data looks like ToDoListItem[]
        if (!Array.isArray(importedItems) || importedItems.some(item => !item.id || typeof item.text !== 'string' || typeof item.completed !== 'boolean')) {
             toast({ title: "Import Failed", description: "Invalid JSON format. File does not contain a valid list of tasks.", variant: "destructive" });
             return;
        }

         // Generate new IDs for imported items to prevent conflicts
        const itemsWithNewIds = importedItems.map(item => ({
            ...item,
            id: crypto.randomUUID(),
            // Ensure timePoint objects have correct structure if they exist
            startTime: item.startTime && typeof item.startTime === 'object' && item.startTime !== null && 'hh' in item.startTime && 'mm' in item.startTime && 'period' in item.startTime ? {...item.startTime} as TimePoint : null,
            endTime: item.endTime && typeof item.endTime === 'object' && item.endTime !== null && 'hh' in item.endTime && 'mm' in item.endTime && 'period' in item.endTime ? {...item.endTime} as TimePoint : null,
            // Validate and format dueDate
            dueDate: item.dueDate && isValid(parseISO(item.dueDate)) ? item.dueDate : null,
             // Ensure timeSettingType is valid
            timeSettingType: ['not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'].includes(item.timeSettingType as string) ? item.timeSettingType : 'not_set',
        }));

        setItems(itemsWithNewIds);
        toast({ title: "To-Do List Imported", description: `${itemsWithNewIds.length} tasks loaded from JSON.` });

      } catch (error) {
        toast({ title: "Import Failed", description: "Could not parse JSON file. Please check the file content.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };

  const handleImportExcel = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[] = XLSX.utils.sheet_to_json(worksheet);

         // TODO: Parse the 'json' array into ToDoListItem format, handle headers/comments, validate data, and update state
        const importedItems: ToDoListItem[] = [];

        // Assuming the first row after potential comments/headers is the actual data start
        // Need to find the row that contains the actual data headers
        let dataStartIndex = -1;
        if (json.length > 0) {
           const firstRowKeys = Object.keys(json[0]).map(key => key.trim().toLowerCase());
           if (firstRowKeys.includes('text') && firstRowKeys.includes('completed')) {
              dataStartIndex = 0; // Assuming no header row or header is first row
           } else {
              // Attempt to find a header row by looking for 'text' and 'completed'
              for (let i = 0; i < json.length; i++) {
                 const rowKeys = Object.keys(json[i]).map(key => key.trim().toLowerCase());
                 if (rowKeys.includes('text') && rowKeys.includes('completed')) {
                    dataStartIndex = i;
                    break;
                 }
              }
           }
        }

        if (dataStartIndex === -1) {
            toast({ title: "Import Failed", description: "Could not find valid task data in the Excel file.", variant: "destructive" });
            return;
        }

         // Start processing from the identified data start row
        for (let i = dataStartIndex; i < json.length; i++) {
             const row = json[i];

            // Map Excel row data to ToDoListItem structure
            // Ensure column names match those used in sheet_to_json (can vary based on header row)
            const text = row.text || '';
            const completed = String(row.completed || '').toLowerCase() === 'true';
            const timeSettingType = ['not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'].includes(row.timeSettingType as string) ? row.timeSettingType : 'not_set';

            // Attempt to parse time strings, handling potential errors
            let startTime: TimePoint | null = null;
            if (row.startTime) {
               const parsedTime = parse(String(row.startTime), 'hh:mm a', new Date());
               if (isValid(parsedTime)) {
                  startTime = { hh: format(parsedTime, 'hh'), mm: format(parsedTime, 'mm'), period: format(parsedTime, 'a') as 'AM' | 'PM' };
               } else {
                  console.warn("Invalid startTime in Excel import:", row.startTime);
               }
            }

             let endTime: TimePoint | null = null;
            if (row.endTime) {
               const parsedTime = parse(String(row.endTime), 'hh:mm a', new Date());
               if (isValid(parsedTime)) {
                  endTime = { hh: format(parsedTime, 'hh'), mm: format(parsedTime, 'mm'), period: format(parsedTime, 'a') as 'AM' | 'PM' };
               } else {
                  console.warn("Invalid endTime in Excel import:", row.endTime);
               }
            }

             // Attempt to parse dueDate string, handling potential errors and different formats
            let dueDate: string | null = null;
            if (row.dueDate) {
                let dateCandidate = String(row.dueDate);
                let parsedDate = parseISO(dateCandidate); // Try ISO format first
                if (!isValid(parsedDate)) {
                    // If not ISO, try dd/MM/yyyy or MM/dd/yyyy (common Excel date formats)
                    parsedDate = parse(dateCandidate, 'dd/MM/yyyy', new Date());
                     if (!isValid(parsedDate)) {
                       parsedDate = parse(dateCandidate, 'MM/dd/yyyy', new Date());
                     }
                     // Excel might store dates as numbers (days since 1900)
                    if (!isValid(parsedDate) && typeof row.dueDate === 'number') {
                       const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // Excel epoch is Dec 30, 1899
                       parsedDate = new Date(excelEpoch.getTime() + row.dueDate * 24 * 60 * 60 * 1000);
                    }
                }
                if (isValid(parsedDate)) {
                    dueDate = format(parsedDate, 'yyyy-MM-dd');
                } else {
                     console.warn("Invalid dueDate in Excel import:", row.dueDate);
                }
            }

            // Add item to the list if it has a text value
            if (text.trim()) {
                importedItems.push({
                    id: crypto.randomUUID(), // Generate new IDs on import
                    text: text.trim(),
                    completed: completed,
                    timeSettingType: timeSettingType as TimeSettingType,
                    startTime: startTime,
                    endTime: endTime,
                    dueDate: dueDate,
                });
            }
        }

        if (importedItems.length === 0) {
            toast({ title: "Import Failed", description: "No valid tasks found in the Excel file.", variant: "destructive" });
            return;
        }

        setItems(importedItems);
        toast({ title: "To-Do List Imported", description: `${importedItems.length} tasks loaded from Excel.` });

      } catch (error) {
         toast({ title: "Import Failed", description: "Could not process Excel file. Please check the format.", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleImportText = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const textContent = e.target?.result as string;
        // TODO: Implement text parsing logic into ToDoListItem[]
         console.log("Imported Text Data:", textContent); // Log data for debugging
        toast({ title: "Import Failed", description: "Text import is not yet implemented.", variant: "default" }); // Placeholder toast
      } catch (error) {
        toast({ title: "Import Failed", description: "Could not process text file.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };


  const sortedItems = useMemo(() => {
    let displayItems = [...items]; 
    const defaultSortedItems = [...items]; 

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
    recognition.continuous = true; 
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
        }, 2000); 
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
      }
      if (event.error === 'aborted') {
        console.info('Task input speech recognition aborted:', event.message);
      } else if (event.error === 'no-speech') {
        console.warn('Task input speech recognition: No speech detected.', event.message);
        if (isListeningForTaskInput) { // Only toast if user was actively dictating
          toast({ title: "No speech detected", variant: "default" });
        }
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.error('Task input speech recognition error:', event.error, event.message);
        setTaskInputMicPermission('denied');
        toast({ title: "Microphone Access Denied", variant: "destructive" });
      } else {
        console.error('Task input speech recognition error:', event.error, event.message);
        toast({ title: "Voice Input Error", description: event.message || "Could not recognize speech.", variant: "destructive" });
      }
      setIsListeningForTaskInput(false);
    };
    recognition.onend = () => {
      setIsListeningForTaskInput(false);
      if (pauseTaskTimeoutRef.current) {
        clearTimeout(pauseTaskTimeoutRef.current);
      }
      recognitionTaskRef.current = null; 
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
      pageRecognition.continuous = true; 
      pageRecognition.interimResults = false; 
      pageRecognition.lang = 'en-US';

      pageRecognition.onstart = () => setIsListeningForPageWakeWord(true);
      pageRecognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
         const detectedWakeWord = transcript === WAKE_WORDS.HEGGLES_BASE.toLowerCase() 
          ? WAKE_WORDS.HEGGLES_BASE 
          : null; 

        if (detectedWakeWord) {
          toast({ title: `'${detectedWakeWord.charAt(0).toUpperCase() + detectedWakeWord.slice(1)}' Detected`, description: "Activating task input microphone..." });
          pageWakeWordListenerShouldBeActive.current = false;
          if (pageWakeWordRecognitionRef.current?.stop) { 
            try { pageWakeWordRecognitionRef.current.stop(); } catch(e) {/* ignore */}
          }
          triggerTaskInputMic(); 
        }
      };
      pageRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('Page Wake Word recognition error:', event.error, event.message);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setPageWakeWordMicPermission('denied');
        } else if (event.error === 'no-speech' && isListeningForPageWakeWord) {
        }
      };
      pageRecognition.onend = () => {
        setIsListeningForPageWakeWord(false); 
        pageWakeWordRecognitionRef.current = null; 
      };
      
      try {
        if (pageWakeWordListenerShouldBeActive.current) pageRecognition.start();
      } catch (e) {
        console.error("Failed to start page Wake Word recognition:", e);
        setIsListeningForPageWakeWord(false);
        pageWakeWordRecognitionRef.current = null;
      }
    }
    
    return () => { 
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
             <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger className="w-[120px] h-8" aria-label="Export format">
                   <SelectValue placeholder="Export As..." />
                </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="csv">CSV</SelectItem>
                   <SelectItem value="json">JSON</SelectItem>
                    <SelectItem value="excel">Excel</SelectItem>
                   <SelectItem value="text">Text (WIP)</SelectItem>
                </SelectContent>
                <Button variant="outline" onClick={handleExportList} size="sm" className="ml-2">Export List</Button>
            </Select>

            <Button variant="outline" onClick={handleExportTemplate} size="sm">Export Template</Button>

             <Select value={importFormat} onValueChange={setImportFormat}>
                <SelectTrigger className="w-[120px] h-8" aria-label="Import format">
                   <SelectValue placeholder="Import From..." />
                </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="csv">CSV</SelectItem>
                   <SelectItem value="json">JSON</SelectItem>
                   <SelectItem value="excel">Excel (WIP)</SelectItem>
                   <SelectItem value="text">Text (WIP)</SelectItem>
                </SelectContent>
            </Select>
            <Button variant="outline" size="sm"> 
                <Label htmlFor="import-todo-list" className="cursor-pointer" asChild>Import List</Label>
                 <Input
                    id="import-todo-list"
                    type="file"
                    accept={importFormat === 'json' ? '.json' : importFormat === 'csv' ? '.csv' : importFormat === 'excel' ? '.xlsx' : importFormat === 'text' ? '.txt' : ''}
                    className="hidden"
                    onChange={(e) => {
                       if (importFormat === 'json') handleImportJSON(e);
                       else if (importFormat === 'csv') handleImportCSV(e);
                       else if (importFormat === 'excel') handleImportExcel(e);
                       else if (importFormat === 'text') handleImportText(e);
                       // Clear the file input value so the same file can be imported again if needed
                       e.target.value = ''; 
                    }}
                 />
           </Button>
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

    
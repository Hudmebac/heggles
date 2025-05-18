
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
  ChevronUp, ChevronDown, GripVertical, CalendarIcon, AlertTriangle, Mic, MicOff, Import
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

  // Ref for the hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    setIsClient(true);
    const SpeechRecognitionAPI = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setTaskInputMicPermission('unsupported');
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
            let hVal = (currentEditorStartTime.hh === '' || currentEditorStartTime.hh === null) ? 12 : parseInt(currentEditorStartTime.hh, 10);
            let mVal = (currentEditorStartTime.mm === '' || currentEditorStartTime.mm === null) ? 0 : parseInt(currentEditorStartTime.mm, 10);

            if (isNaN(hVal) || hVal < 1 || hVal > 12 || isNaN(mVal) || mVal < 0 || mVal > 59) {
                 if ((currentEditorStartTime.hh === '' || currentEditorStartTime.hh === null) &&
                     (currentEditorStartTime.mm === '' || currentEditorStartTime.mm === null) &&
                      currentEditorStartTime.period) {
                    hVal = 12; mVal = 0; 
                 } else if (currentEditorStartTime.hh || currentEditorStartTime.mm) { 
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
            let hVal = (currentEditorEndTime.hh === '' || currentEditorEndTime.hh === null) ? 12 : parseInt(currentEditorEndTime.hh, 10);
            let mVal = (currentEditorEndTime.mm === '' || currentEditorEndTime.mm === null) ? 0 : parseInt(currentEditorEndTime.mm, 10);

            if (isNaN(hVal) || hVal < 1 || hVal > 12 || isNaN(mVal) || mVal < 0 || mVal > 59) {
                 if ((currentEditorEndTime.hh === '' || currentEditorEndTime.hh === null) &&
                     (currentEditorEndTime.mm === '' || currentEditorEndTime.mm === null) &&
                     currentEditorEndTime.period) {
                    hVal = 12; mVal = 0; 
                 } else if (currentEditorEndTime.hh || currentEditorEndTime.mm) { 
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
        else if (!newStartTime && newEndTime) { 
            newEndTime = null;
            finalTimeSettingType = 'not_set';
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
      else if (field === 'hh') newPoint.hh = value.replace(/[^0-9]/g, '').slice(0, 2);

      if (field === 'mm' && value === '') newPoint.mm = ''; 
      else if (field === 'mm') newPoint.mm = value.replace(/[^0-9]/g, '').slice(0, 2);

      return newPoint;
    });
  };

  const displayFormattedTime = (item: ToDoListItem): string => {
    if (!item.timeSettingType || item.timeSettingType === 'not_set') return 'No time set';
    if (item.timeSettingType === 'all_day') return 'All Day';

    const formatSinglePoint = (point: TimePoint | null | undefined) => {
        if (!point) return null;
        if (!point.period) return null; 
        const hStr = point.hh || "12"; 
        const mStr = point.mm || "00"; 
        return `${hStr.padStart(2, '0')}:${mStr.padStart(2, '0')} ${point.period}`;
    };

    if (item.timeSettingType === 'am_period') return 'AM';
    if (item.timeSettingType === 'pm_period') return 'PM';

    let displayStr = "";
    if (item.startTime) {
      const formattedStart = formatSinglePoint(item.startTime);
      if (formattedStart) displayStr += `Starts ${formattedStart}`;
      else if (item.timeSettingType === 'specific_start' || item.timeSettingType === 'specific_start_end') {
           displayStr += 'Invalid start time'; 
      }
    }
    if (item.timeSettingType === 'specific_start_end' && item.endTime) {
      const formattedEnd = formatSinglePoint(item.endTime);
       if (formattedEnd) displayStr += displayStr ? ` - Ends ${formattedEnd}` : `Ends ${formattedEnd}`;
       else {
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

  const handleDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    if (sortOrder !== 'default') { e.preventDefault(); return; }
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


  const processCSVImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target?.result as string;
        const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trim().toLowerCase().startsWith('#'));

        if (lines.length === 0) {
           toast({ title: "Import Failed", description: "The selected file is empty or contains only comments.", variant: "destructive" });
           return;
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const expectedHeaders = ["text", "completed", "timesettingtype", "starttime", "endtime", "duedate"]; 

         if (!expectedHeaders.every(h => headers.includes(h))) {
             toast({ title: "Import Failed", description: "Invalid CSV format. Missing required columns (case-insensitive): " + expectedHeaders.filter(h => !headers.includes(h)).join(', '), variant: "destructive" });
             return;
         }
         
         if (lines.length <=1) {
           toast({ title: "Import Failed", description: "No data rows found after header in CSV.", variant: "destructive" });
           return;
         }


        const importedItems: ToDoListItem[] = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(','); 
          const itemData: Record<string, string> = {};
          headers.forEach((header, index) => {
             let value = values[index];
             if (value && value.startsWith('"') && value.endsWith('"')) {
                 value = value.substring(1, value.length - 1).replace(/""/g, '"');
             }
             itemData[header] = value?.trim();
          });

          const startTimeString = itemData['starttime'];
          const endTimeString = itemData['endtime'];

          const timeSettingType = (itemData['timesettingtype'] as TimeSettingType) || 'not_set';

          importedItems.push({
            id: crypto.randomUUID(),
            text: itemData['text'] || 'Unnamed Task',
            completed: itemData['completed']?.toLowerCase() === 'true',
            timeSettingType: ['not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'].includes(timeSettingType) ? timeSettingType : 'not_set',
            startTime: startTimeString && parse(startTimeString, 'hh:mm a', new Date()) ? { hh: format(parse(startTimeString, 'hh:mm a', new Date()), 'hh'), mm: format(parse(startTimeString, 'hh:mm a', new Date()), 'mm'), period: format(parse(startTimeString, 'hh:mm a', new Date()), 'a').toUpperCase() as 'AM' | 'PM' } : null,
            endTime: endTimeString && parse(endTimeString, 'hh:mm a', new Date()) ? { hh: format(parse(endTimeString, 'hh:mm a', new Date()), 'hh'), mm: format(parse(endTimeString, 'hh:mm a', new Date()), 'mm'), period: format(parse(endTimeString, 'hh:mm a', new Date()), 'a').toUpperCase() as 'AM' | 'PM' } : null,
            dueDate: itemData['duedate'] && isValid(parseISO(itemData['duedate'])) ? itemData['duedate'] : null,
          });
        }
        
        if (importedItems.length === 0) {
            toast({ title: "Import Warning", description: "No valid tasks could be imported from the CSV. Check data rows.", variant: "default" });
            return;
        }

        setItems(importedItems);
        toast({ title: "To-Do List Imported", description: `${importedItems.length} tasks loaded from CSV.` });

      } catch (error) {
        console.error("CSV Import error:", error);
        toast({ title: "Import Failed", description: "Could not process CSV file. Please check the format.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  };

  const processJSONImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonText = e.target?.result as string;
        const importedItemsRaw: any[] = JSON.parse(jsonText);

        if (!Array.isArray(importedItemsRaw) ) {
             toast({ title: "Import Failed", description: "Invalid JSON format. File does not contain a valid list of tasks.", variant: "destructive" });
             return;
        }

        const itemsWithNewIds = importedItemsRaw.map(item => {
          if (typeof item.text !== 'string' || typeof item.completed !== 'boolean') {
            console.warn("Skipping invalid item in JSON import:", item);
            return null; // Skip invalid items
          }
          return {
            ...item,
            id: crypto.randomUUID(),
            startTime: item.startTime && typeof item.startTime === 'object' && item.startTime !== null && 'hh' in item.startTime && 'mm' in item.startTime && 'period' in item.startTime ? {...item.startTime} as TimePoint : null,
            endTime: item.endTime && typeof item.endTime === 'object' && item.endTime !== null && 'hh' in item.endTime && 'mm' in item.endTime && 'period' in item.endTime ? {...item.endTime} as TimePoint : null,
            dueDate: item.dueDate && isValid(parseISO(item.dueDate)) ? item.dueDate : null,
            timeSettingType: ['not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'].includes(item.timeSettingType as string) ? item.timeSettingType : 'not_set',
        }}).filter(Boolean) as ToDoListItem[]; // Filter out nulls

        if (itemsWithNewIds.length === 0 && importedItemsRaw.length > 0) {
             toast({ title: "Import Warning", description: "No valid tasks could be imported from the JSON. Check item structure (requires 'text' and 'completed').", variant: "default" });
            return;
        }
         if (itemsWithNewIds.length === 0 && importedItemsRaw.length === 0) {
             toast({ title: "Import Failed", description: "JSON file is empty or contains no tasks.", variant: "destructive" });
            return;
        }

        setItems(itemsWithNewIds);
        toast({ title: "To-Do List Imported", description: `${itemsWithNewIds.length} tasks loaded from JSON.` });

      } catch (error) {
        toast({ title: "Import Failed", description: (error as Error).message || "Could not parse JSON file. Please check the file content.", variant: "destructive" });
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
        const json: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 }); 

        let headers: string[] = [];
        let dataStartIndex = -1;

        for(let i = 0; i < json.length; i++) {
          const row = json[i] as any[];
          if (row.some(cell => typeof cell === 'string' && cell.trim().toLowerCase() === 'text')) {
            headers = row.map(cell => String(cell || '').trim().toLowerCase());
            dataStartIndex = i + 1;
            break;
          }
        }

        if (dataStartIndex === -1 || headers.length === 0) {
            toast({ title: "Import Failed", description: "Could not find valid header row in Excel (must contain 'text').", variant: "destructive" });
            return;
        }
        
        const textIndex = headers.indexOf('text');
        const completedIndex = headers.indexOf('completed');
        const timeSettingTypeIndex = headers.indexOf('timesettingtype');
        const startTimeIndex = headers.indexOf('starttime');
        const endTimeIndex = headers.indexOf('endtime');
        const dueDateIndex = headers.indexOf('duedate');

        if (textIndex === -1) {
           toast({ title: "Import Failed", description: "Excel file must contain a 'text' column.", variant: "destructive" });
           return;
        }

        const importedItems: ToDoListItem[] = [];
        for (let i = dataStartIndex; i < json.length; i++) {
            const row = json[i] as any[];
            const text = String(row[textIndex] || '').trim();
            const completed = completedIndex > -1 ? String(row[completedIndex] || '').toLowerCase() === 'true' : false;
            const timeSettingTypeRaw = timeSettingTypeIndex > -1 ? String(row[timeSettingTypeIndex] || '').toLowerCase() : 'not_set';
            const timeSettingType = ['not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'].includes(timeSettingTypeRaw) ? timeSettingTypeRaw : 'not_set';

            let startTime: TimePoint | null = null;
            if (startTimeIndex > -1 && row[startTimeIndex]) {
               const parsedTime = parse(String(row[startTimeIndex]), 'hh:mm a', new Date());
               if (isValid(parsedTime)) {
                  startTime = { hh: format(parsedTime, 'hh'), mm: format(parsedTime, 'mm'), period: format(parsedTime, 'a').toUpperCase() as 'AM' | 'PM' };
               }
            }

             let endTime: TimePoint | null = null;
            if (endTimeIndex > -1 && row[endTimeIndex]) {
               const parsedTime = parse(String(row[endTimeIndex]), 'hh:mm a', new Date());
               if (isValid(parsedTime)) {
                  endTime = { hh: format(parsedTime, 'hh'), mm: format(parsedTime, 'mm'), period: format(parsedTime, 'a').toUpperCase() as 'AM' | 'PM' };
               }
            }

            let dueDate: string | null = null;
            if (dueDateIndex > -1 && row[dueDateIndex]) {
                let dateCandidate = String(row[dueDateIndex]);
                let parsedDate = parseISO(dateCandidate); 
                if (!isValid(parsedDate)) parsedDate = parse(dateCandidate, 'dd/MM/yyyy', new Date()); 
                if (!isValid(parsedDate)) parsedDate = parse(dateCandidate, 'MM/dd/yyyy', new Date()); 
                if (!isValid(parsedDate) && typeof row[dueDateIndex] === 'number') { 
                   const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                   parsedDate = new Date(excelEpoch.getTime() + (row[dueDateIndex] as number) * 24 * 60 * 60 * 1000);
                }
                if (isValid(parsedDate)) {
                    dueDate = format(parsedDate, 'yyyy-MM-dd');
                }
            }

            if (text) {
                importedItems.push({
                    id: crypto.randomUUID(),
                    text: text,
                    completed: completed,
                    timeSettingType: timeSettingType as TimeSettingType,
                    startTime: startTime,
                    endTime: endTime,
                    dueDate: dueDate,
                });
            }
        }

        if (importedItems.length === 0 && json.length > dataStartIndex) {
            toast({ title: "Import Warning", description: "No valid tasks could be extracted from the Excel file, or all tasks were empty.", variant: "default" });
            return;
        }
        if (importedItems.length === 0 && json.length <= dataStartIndex) {
             toast({ title: "Import Failed", description: "No data rows found after headers/comments in Excel.", variant: "destructive" });
            return;
        }

        setItems(importedItems);
        toast({ title: "To-Do List Imported", description: `${importedItems.length} tasks loaded from Excel.` });

      } catch (error) {
         console.error("Excel import error:", error);
         toast({ title: "Import Failed", description: "Could not process Excel file. Please check the format and ensure column names (text, completed, etc.) are correct.", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
  };

  const processTextImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '' && !line.startsWith('#'));
        if (lines.length === 0) {
          toast({ title: "Import Failed", description: "Text file is empty or contains only comments/whitespace.", variant: "destructive" });
          return;
        }
        const importedItems: ToDoListItem[] = lines.map(line => ({
          id: crypto.randomUUID(),
          text: line.trim(),
          completed: false,
          timeSettingType: 'not_set',
          startTime: null,
          endTime: null,
          dueDate: null,
        }));
        setItems(importedItems);
        toast({ title: "To-Do List Imported", description: `${importedItems.length} tasks loaded from Text file.` });
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


  const sortedItems = useMemo(() => {
    let displayItems = [...items];
    const defaultSortedItems = [...items]; 

    switch (sortOrder) {
      case 'dueDateAsc':
        displayItems.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return defaultSortedItems.indexOf(a) - defaultSortedItems.indexOf(b);
          if (!a.dueDate) return 1; 
          if (!b.dueDate) return -1; 
          const dateDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          return defaultSortedItems.indexOf(a) - defaultSortedItems.indexOf(b); 
        });
        break;
      case 'dueDateDesc':
        displayItems.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return defaultSortedItems.indexOf(a) - defaultSortedItems.indexOf(b);
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          const dateDiff = new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          return defaultSortedItems.indexOf(a) - defaultSortedItems.indexOf(b);
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
          return defaultSortedItems.indexOf(a) - defaultSortedItems.indexOf(b);
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
      const stopCommand = WAKE_WORDS.STOP_DICTATION.toLowerCase();

      if (lowerTranscript.endsWith(endCommand) || lowerTranscript.endsWith(stopCommand)) {
        if (lowerTranscript.endsWith(endCommand)) {
            transcript = transcript.substring(0, transcript.length - endCommand.length).trim();
        } else if (lowerTranscript.endsWith(stopCommand)) {
            transcript = transcript.substring(0, transcript.length - stopCommand.length).trim();
        }
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
        console.info('Task input speech recognition aborted.');
      } else if (event.error === 'no-speech') {
        if (isListeningForTaskInput) {
           // console.warn("No speech detected for task input.");
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
    };

    setNewItemText('');
    recognition.start();
  }, [taskInputMicPermission, toast, isListeningForTaskInput, setNewItemText]);


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
      startTaskInputRecognition();
    }
  }, [isListeningForTaskInput, taskInputMicPermission, startTaskInputRecognition, toast]);


  if (!isClient) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <ClipboardList className="h-16 w-16 animate-pulse text-primary" />
      </div>
    );
  }

  const renderTimePointInput = (type: 'start' | 'end', _timePoint: TimePoint | null) => { 
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
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-10 w-10 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">To-Do List</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-center sm:justify-end mt-2 sm:mt-0">
            <Button 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              className="h-10"
              aria-label="Import to-do tasks"
            >
              <Import className="mr-2 h-5 w-5" /> Import Tasks
            </Button>
            <Select value={sortOrder} onValueChange={setSortOrder}>
                <SelectTrigger className="w-full xs:w-[180px] sm:w-[200px]" aria-label="Sort tasks by">
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

      <input
        id="import-todo-list-file"
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,.xlsx,.xls,.txt"
        style={visuallyHiddenStyle}
        onChange={handleFileSelectedForImport}
      />


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
              className="p-2 h-10 w-10 shrink-0"
              onClick={triggerTaskInputMic}
              disabled={taskMicButtonDisabled && taskInputMicPermission !== 'prompt'}
              title={taskMicButtonDisabled && taskInputMicPermission !== 'prompt' ? "Voice input unavailable" : (isListeningForTaskInput ? "Stop voice input (or say 'Heggles end/stop')" : "Add task using voice")}
              aria-label="Add task using voice"
            >
              {isListeningForTaskInput ? <Mic className="h-6 w-6 text-primary animate-pulse" /> :
               (taskMicButtonDisabled ? <MicOff className="h-6 w-6 text-muted-foreground" /> : <Mic className="h-6 w-6" />)}
            </Button>
            <Button type="submit" aria-label="Add task" className="px-3 sm:px-4 h-10">
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
                  onDragStart={(e) => handleDragStart(e, item.id)}
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
          <p className="text-muted-foreground mt-2">Add tasks using the form above or import a list to get started.</p>
        </div>
      )}
    </div>
  );
}

    
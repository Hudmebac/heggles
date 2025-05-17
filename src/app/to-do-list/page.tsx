
"use client";

import { useState, useEffect, FormEvent, DragEvent, useMemo } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { ToDoListItem, TimePoint, TimeSettingType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Label } from '@/components/ui/label'; // Added missing import
import { format, parseISO, isValid, isPast, isToday, isTomorrow } from 'date-fns';
import { 
  ClipboardList, Trash2, Edit3, PlusCircle, Save, Ban, CheckSquare, Clock, 
  ChevronUp, ChevronDown, GripVertical, CalendarIcon, AlertTriangle 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LOCALSTORAGE_KEYS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const initialTimePoint: TimePoint = { hh: '12', mm: '00', period: 'AM' };

// Helper to parse time strings like "HH:MM AM/PM" into TimePoint or handle AM/PM only
const parseTimeToTimePoint = (timeStr?: string | null): TimePoint | null => {
  if (!timeStr) return null;
  try {
    if (timeStr === "AM" || timeStr === "PM") {
      return { hh: '12', mm: '00', period: timeStr as 'AM' | 'PM' };
    }
    const [time, periodPart] = timeStr.split(' ');
    if (!periodPart || !['AM', 'PM'].includes(periodPart.toUpperCase())) return null;
    const [hh, mm] = time.split(':');
    if (isNaN(parseInt(hh)) || isNaN(parseInt(mm))) return null;
    return { hh, mm, period: periodPart.toUpperCase() as 'AM' | 'PM' };
  } catch (e) {
    return null;
  }
};

// Helper to format TimePoint into "HH:MM AM/PM" string
const formatTimePointToString = (timePoint?: TimePoint | null): string | null => {
  if (!timePoint) return null;
  const h = parseInt(timePoint.hh, 10);
  const m = parseInt(timePoint.mm, 10);
  if (isNaN(h) || isNaN(m) || h < 1 || h > 12 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${timePoint.period}`;
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
  useEffect(() => {
    setIsClient(true);
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
    setCurrentEditorStartTime(item.startTime || null);
    setCurrentEditorEndTime(item.endTime || null);
    setCurrentEditorDueDate(item.dueDate ? parseISO(item.dueDate) : undefined);
    setEditingItemId(null);
  };

  const handleSaveTimeSettings = () => {
    if (!editingTimeItemId) return;

    let newStartTime: TimePoint | null = null;
    let newEndTime: TimePoint | null = null;

    if (currentEditorTimeSettingType === 'specific_start' || currentEditorTimeSettingType === 'specific_start_end') {
      if (currentEditorStartTime && formatTimePointToString(currentEditorStartTime)) {
        newStartTime = currentEditorStartTime;
      } else {
        toast({ title: "Invalid Start Time", description: "Please enter a valid start time (HH: 1-12, MM: 00-59).", variant: "destructive" });
        return;
      }
    }
    if (currentEditorTimeSettingType === 'specific_start_end') {
      if (currentEditorEndTime && formatTimePointToString(currentEditorEndTime)) {
        newEndTime = currentEditorEndTime;
      } else {
        toast({ title: "Invalid End Time", description: "Please enter a valid end time (HH: 1-12, MM: 00-59).", variant: "destructive" });
        return;
      }
      // Basic validation: end time should be after start time (if both specific)
      if (newStartTime && newEndTime) {
        const startTotalMinutes = (parseInt(newStartTime.hh) % 12 + (newStartTime.period === 'PM' && parseInt(newStartTime.hh) !== 12 ? 12 : 0)) * 60 + parseInt(newStartTime.mm);
        const endTotalMinutes = (parseInt(newEndTime.hh) % 12 + (newEndTime.period === 'PM' && parseInt(newEndTime.hh) !== 12 ? 12 : 0)) * 60 + parseInt(newEndTime.mm);
        if (endTotalMinutes <= startTotalMinutes) {
          // toast({ title: "Invalid Time Range", description: "End time must be after start time.", variant: "destructive" });
          // return; 
          // Allowing same day overnight for now, complex validation deferred
        }
      }
    }
    
    if (currentEditorTimeSettingType === 'am_period') newStartTime = { hh: '12', mm: '00', period: 'AM' };
    if (currentEditorTimeSettingType === 'pm_period') newStartTime = { hh: '12', mm: '00', period: 'PM' };


    setItems(items.map(item => {
      if (item.id === editingTimeItemId) {
        return { 
          ...item, 
          timeSettingType: currentEditorTimeSettingType,
          startTime: currentEditorTimeSettingType === 'not_set' || currentEditorTimeSettingType === 'all_day' ? null : newStartTime,
          endTime: currentEditorTimeSettingType === 'specific_start_end' ? newEndTime : null,
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
    setEditingTimeItemId(null); // Close editor after clearing
  };

  const handleCancelTimeEditor = () => {
    setEditingTimeItemId(null);
  };
  
  const handleTempTimeChange = (type: 'start' | 'end', field: 'hh' | 'mm' | 'period', value: string) => {
    const setter = type === 'start' ? setCurrentEditorStartTime : setCurrentEditorEndTime;
    setter(prev => ({ ...(prev || initialTimePoint), [field]: value }));
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
    }
    if (item.timeSettingType === 'specific_start_end' && item.endTime) {
      const formattedEnd = formatTimePointToString(item.endTime);
      if (formattedEnd) displayStr += displayStr ? ` - Ends ${formattedEnd}` : `Ends ${formattedEnd}`;
    }
    return displayStr || 'Time set (see details)';
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
    let displayItems = [...items];
    switch (sortOrder) {
      case 'dueDateAsc':
        displayItems.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1; // items without due date last
          if (!b.dueDate) return -1; // items without due date last
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        });
        break;
      case 'dueDateDesc':
        displayItems.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
        });
        break;
      case 'alphaAsc':
        displayItems.sort((a, b) => a.text.localeCompare(b.text));
        break;
      case 'alphaDesc':
        displayItems.sort((a, b) => b.text.localeCompare(a.text));
        break;
      case 'priority': // Placeholder - no priority field yet
      default:
        // Default order is as stored (supports drag/drop)
        break;
    }
    return displayItems;
  }, [items, sortOrder]);


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
        <Select value={currentVal?.period || 'AM'} onValueChange={(val) => handleTempTimeChange(type, 'period', val)}>
          <SelectTrigger className="w-20 h-8 px-2 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent>
        </Select>
      </div>
    );
  };


  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-10 w-10 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">To-Do List</h1>
        </div>
        <div className="w-full sm:w-auto">
          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Sort tasks by">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default Order</SelectItem>
              <SelectItem value="dueDateAsc">Due Date (Oldest First)</SelectItem>
              <SelectItem value="dueDateDesc">Due Date (Newest First)</SelectItem>
              <SelectItem value="alphaAsc">Alphabetical (A-Z)</SelectItem>
              <SelectItem value="alphaDesc">Alphabetical (Z-A)</SelectItem>
              <SelectItem value="priority" disabled>Priority (Coming Soon)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl">Add New Task</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddItem} className="flex items-center gap-3">
            <Input
              type="text"
              value={newItemText}
              onChange={(e) => setNewItemText(e.target.value)}
              placeholder="E.g., Finish report, Call John"
              className="flex-grow"
              aria-label="New to-do list item"
            />
            <Button type="submit" aria-label="Add task">
              <PlusCircle className="mr-2 h-5 w-5" /> Add Task
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
                          <Button variant="ghost" size="icon" onClick={() => handleMoveItem(items.findIndex(i => i.id === item.id), 'up')} disabled={items.findIndex(i => i.id === item.id) === 0} title="Move up" className="h-7 w-7">
                            <ChevronUp className="h-5 w-5" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleMoveItem(items.findIndex(i => i.id === item.id), 'down')} disabled={items.findIndex(i => i.id === item.id) === items.length - 1} title="Move down" className="h-7 w-7">
                            <ChevronDown className="h-5 w-5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Collapsible Time and Date Editor */}
                  {!item.completed && (
                    <div className="pl-8"> {/* Indent editor section */}
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

    
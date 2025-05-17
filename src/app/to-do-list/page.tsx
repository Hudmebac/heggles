
"use client";

import { useState, useEffect, FormEvent, DragEvent } from 'react';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import type { ToDoListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList, Trash2, Edit3, PlusCircle, Save, Ban, CheckSquare, Clock, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { LOCALSTORAGE_KEYS } from '@/lib/constants';
import { cn } from '@/lib/utils';

const parseTime = (timeStr?: string): { hh: string; mm: string; period: 'AM' | 'PM' } => {
  if (!timeStr) return { hh: '', mm: '', period: 'AM' }; // Default to AM, empty HH/MM
  if (timeStr === "AM" || timeStr === "PM") return { hh: '', mm: '', period: timeStr as 'AM' | 'PM'};

  try {
    const [time, periodPart] = timeStr.split(' ');
    const [hh, mm] = time.split(':');
    if (!periodPart || !['AM', 'PM'].includes(periodPart.toUpperCase()) || (hh && isNaN(parseInt(hh))) || (mm && isNaN(parseInt(mm)))) {
      // If period is missing or invalid, or hh/mm are not numbers, treat as not set or default
      return { hh: '', mm: '', period: (periodPart?.toUpperCase() === 'PM' ? 'PM' : 'AM') };
    }
    return { hh: hh || '', mm: mm || '', period: periodPart.toUpperCase() as 'AM' | 'PM' };
  } catch (e) {
    return { hh: '', mm: '', period: 'AM' };
  }
};

const formatTime = (hh: string, mm: string, period: 'AM' | 'PM'): string | null => {
  const hVal = hh.trim();
  const mVal = mm.trim();

  if (!hVal && !mVal) { // Only period is set
    return `12:00 ${period}`;
  }

  const h = parseInt(hVal, 10);
  const m = parseInt(mVal, 10);

  if (isNaN(h) || isNaN(m) || h < 1 || h > 12 || m < 0 || m > 59) {
    return null; // Invalid numeric input
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
};

export default function ToDoListPage() {
  const [items, setItems] = useLocalStorage<ToDoListItem[]>(LOCALSTORAGE_KEYS.TODO_LIST, []);
  const [newItemText, setNewItemText] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState('');
  
  const [editingTimeForItem, setEditingTimeForItem] = useState<{ id: string; type: 'start' | 'end' } | null>(null);
  const [tempTime, setTempTime] = useState<{ hh: string; mm: string; period: 'AM' | 'PM' }>({ hh: '', mm: '', period: 'AM' });

  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);

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
    setItems(prevItems => [...prevItems, { id: crypto.randomUUID(), text: newItemText.trim(), completed: false }]);
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
    if (editingTimeForItem?.id === id || editingItemId === id) {
      setEditingTimeForItem(null);
      setEditingItemId(null);
    }
  };

  const handleStartEdit = (item: ToDoListItem) => {
    if (item.completed) return;
    setEditingItemId(item.id);
    setEditingItemText(item.text);
    setEditingTimeForItem(null); 
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

  const handleOpenTimeEditor = (itemId: string, type: 'start' | 'end') => {
    const item = items.find(i => i.id === itemId);
    if (!item || item.completed) return;
    setEditingTimeForItem({ id: itemId, type });
    const currentTime = type === 'start' ? item.startTime : item.endTime;
    setTempTime(parseTime(currentTime));
    setEditingItemId(null); 
  };

  const handleSaveTime = () => {
    if (!editingTimeForItem) return;
    const formatted = formatTime(tempTime.hh, tempTime.mm, tempTime.period);
    if (!formatted) {
      toast({ title: "Invalid Time", description: "Please enter a valid time (HH: 1-12, MM: 00-59) or leave HH/MM blank for default.", variant: "destructive" });
      return;
    }
    setItems(items.map(item => {
      if (item.id === editingTimeForItem.id) {
        return { ...item, [editingTimeForItem.type === 'start' ? 'startTime' : 'endTime']: formatted };
      }
      return item;
    }));
    toast({ title: `${editingTimeForItem.type === 'start' ? 'Start' : 'End'} Time Saved` });
    setEditingTimeForItem(null);
  };

  const handleCancelTimeEdit = () => {
    setEditingTimeForItem(null);
  };
  
  const handleTempTimeChange = (field: 'hh' | 'mm' | 'period', value: string) => {
    setTempTime(prev => ({ ...prev, [field]: value }));
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
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

  // Drag and Drop Handlers
  const handleDragStart = (id: string) => {
    setDraggedItemId(id);
  };

  const handleDragOver = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault(); // Necessary to allow dropping
  };

  const handleDrop = (targetItemId: string) => {
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


  if (!isClient) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
        <ClipboardList className="h-16 w-16 animate-pulse text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-10 w-10 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">To-Do List</h1>
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

      {items.length > 0 ? (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">Your Tasks ({items.filter(i => !i.completed).length} pending)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-4">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  draggable={!item.completed}
                  onDragStart={() => handleDragStart(item.id)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(item.id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    "p-4 rounded-lg transition-all flex gap-2",
                    item.completed ? 'bg-muted/50 opacity-70' : 'bg-card-foreground/5 hover:bg-card-foreground/10',
                    draggedItemId === item.id && !item.completed ? 'opacity-50 border-2 border-dashed border-primary' : '',
                    !item.completed && 'cursor-grab'
                  )}
                >
                  {!item.completed && (
                    <GripVertical className="h-5 w-5 text-muted-foreground self-center shrink-0" />
                  )}
                   {item.completed && (
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
                  <div className="flex-grow space-y-2">
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

                    {/* Time Display and Editors */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {/* Start Time */}
                      <div className="space-y-1">
                        <label className="font-medium text-muted-foreground flex items-center"><Clock className="h-3 w-3 mr-1.5"/>Start Time:</label>
                        {editingTimeForItem?.id === item.id && editingTimeForItem?.type === 'start' ? (
                          <div className="flex items-center gap-1 p-1 border rounded-md bg-background">
                            <Input type="text" value={tempTime.hh} onChange={(e) => handleTempTimeChange('hh', e.target.value)} maxLength={2} className="w-10 h-7 text-center px-0.5" placeholder="HH"/>:
                            <Input type="text" value={tempTime.mm} onChange={(e) => handleTempTimeChange('mm', e.target.value)} maxLength={2} className="w-10 h-7 text-center px-0.5" placeholder="MM"/>
                            <Select value={tempTime.period} onValueChange={(val) => handleTempTimeChange('period', val)}>
                              <SelectTrigger className="w-16 h-7 px-1 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" onClick={handleSaveTime} className="h-7 w-7"><Save className="h-4 w-4 text-green-600"/></Button>
                            <Button variant="ghost" size="icon" onClick={handleCancelTimeEdit} className="h-7 w-7"><Ban className="h-4 w-4 text-muted-foreground"/></Button>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            <span className={`py-1 px-2 rounded-md ${item.startTime ? 'bg-primary/10' : 'text-muted-foreground italic'}`}>
                              {item.startTime || 'Not set'}
                            </span>
                            {!item.completed && (
                              <Button variant="outline" size="sm" onClick={() => handleOpenTimeEditor(item.id, 'start')} className="ml-2 h-7 px-2 py-0.5 text-xs">
                                {item.startTime ? 'Edit' : 'Set'}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      {/* End Time */}
                      <div className="space-y-1">
                        <label className="font-medium text-muted-foreground flex items-center"><Clock className="h-3 w-3 mr-1.5"/>End Time:</label>
                         {editingTimeForItem?.id === item.id && editingTimeForItem?.type === 'end' ? (
                          <div className="flex items-center gap-1 p-1 border rounded-md bg-background">
                            <Input type="text" value={tempTime.hh} onChange={(e) => handleTempTimeChange('hh', e.target.value)} maxLength={2} className="w-10 h-7 text-center px-0.5" placeholder="HH"/>:
                            <Input type="text" value={tempTime.mm} onChange={(e) => handleTempTimeChange('mm', e.target.value)} maxLength={2} className="w-10 h-7 text-center px-0.5" placeholder="MM"/>
                            <Select value={tempTime.period} onValueChange={(val) => handleTempTimeChange('period', val)}>
                              <SelectTrigger className="w-16 h-7 px-1 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" onClick={handleSaveTime} className="h-7 w-7"><Save className="h-4 w-4 text-green-600"/></Button>
                            <Button variant="ghost" size="icon" onClick={handleCancelTimeEdit} className="h-7 w-7"><Ban className="h-4 w-4 text-muted-foreground"/></Button>
                          </div>
                        ) : (
                           <div className="flex items-center">
                            <span className={`py-1 px-2 rounded-md ${item.endTime ? 'bg-primary/10' : 'text-muted-foreground italic'}`}>
                              {item.endTime || 'Not set'}
                            </span>
                            {!item.completed && (
                              <Button variant="outline" size="sm" onClick={() => handleOpenTimeEditor(item.id, 'end')} className="ml-2 h-7 px-2 py-0.5 text-xs">
                                {item.endTime ? 'Edit' : 'Set'}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons (Edit Text, Delete, Reorder Arrows) */}
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
                    {!item.completed && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => handleMoveItem(index, 'up')} disabled={index === 0} title="Move up" className="h-7 w-7">
                          <ChevronUp className="h-5 w-5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleMoveItem(index, 'down')} disabled={index === items.length - 1} title="Move down" className="h-7 w-7">
                          <ChevronDown className="h-5 w-5" />
                        </Button>
                      </>
                    )}
                  </div>
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

    
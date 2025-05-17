
"use client";

import { useState, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle, Timer, Info, Brain } from 'lucide-react'; 
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { BUFFER_TIME_OPTIONS, LOCALSTORAGE_KEYS, DEFAULT_BUFFER_TIME, WAKE_WORDS, type BufferTimeValue, RECORDING_DURATION_MS } from '@/lib/constants';

interface PassiveListenerControlsProps {
  isListening: boolean;
  onToggleListening: (isListening: boolean) => void;
}

export function PassiveListenerControls({ isListening, onToggleListening }: PassiveListenerControlsProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [bufferTime, setBufferTime] = useLocalStorage<BufferTimeValue>(LOCALSTORAGE_KEYS.BUFFER_TIME, DEFAULT_BUFFER_TIME);

  useEffect(() => {
    let timerId: NodeJS.Timeout | undefined;
    if (isListening) {
      setShowWarning(true);
      timerId = setTimeout(() => {
        setShowWarning(false);
      }, 5000);
    } else {
      setShowWarning(false);
    }
    return () => {
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [isListening]);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === LOCALSTORAGE_KEYS.BUFFER_TIME && event.newValue) {
        try {
          const newBufferTimeValue = JSON.parse(event.newValue) as BufferTimeValue;
          if (BUFFER_TIME_OPTIONS.some(opt => opt.value === newBufferTimeValue)) {
            setBufferTime(newBufferTimeValue);
          }
        } catch (e) { /* ignore */ }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [setBufferTime]);


  const handleToggleSwitch = (checked: boolean) => {
    onToggleListening(checked);
  };

  const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const addToDoCmdSuffix = WAKE_WORDS.HEGGLES_ADD_TO_TODO_LIST_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const setBufferCmdSuffix = WAKE_WORDS.HEGGLES_SET_BUFFER.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.HEGGLES_TURN_ON.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.HEGGLES_TURN_OFF.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.HEGGLES_DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const recordingDurationSeconds = RECORDING_DURATION_MS / 1000;


  return (
    <Card className="w-full shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center text-xl">
          {isListening ? <Mic className="mr-2 h-6 w-6 text-primary animate-pulse" /> : <MicOff className="mr-2 h-6 w-6 text-muted-foreground" />}
          Passive Listening
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between space-x-2 p-4 border rounded-lg bg-secondary/30">
          <Label htmlFor="listening-mode-switch" className="text-lg font-medium">
            {isListening ? "Listening Active" : "Listening Inactive"}
          </Label>
          <Switch
            id="listening-mode-switch"
            checked={isListening}
            onCheckedChange={handleToggleSwitch}
            aria-label="Toggle passive listening mode"
          />
        </div>

        <div className="space-y-2 p-4 border rounded-lg bg-secondary/30">
          <Label htmlFor="buffer-time-select" className="text-md font-medium flex items-center">
            <Timer className="mr-2 h-5 w-5 text-muted-foreground" />
            Conceptual Buffer Time (used by '<strong>Heggles</strong>{setBufferCmdSuffix} [duration]' voice command)
          </Label>
          <Select value={bufferTime} onValueChange={(value) => setBufferTime(value as BufferTimeValue)}>
            <SelectTrigger id="buffer-time-select" aria-label="Select buffer time period">
              <SelectValue placeholder="Select buffer time" />
            </SelectTrigger>
            <SelectContent>
              {BUFFER_TIME_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
           <p className="text-xs text-muted-foreground pt-1">
            This setting is primarily for the '<strong>Heggles</strong>{setBufferCmdSuffix}' voice command.
            The '<strong>Heggles</strong>{recallCmdSuffix}' voice command now triggers a {recordingDurationSeconds}-second live recording.
          </p>
        </div>

        {showWarning && (
          <div className="flex items-center p-3 border border-yellow-400 bg-yellow-50 text-yellow-700 rounded-md text-sm">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <span>
              Passive listening is active. Microphone may be used for voice commands.
            </span>
          </div>
        )}
        <div className="flex items-start p-3 border rounded-lg bg-secondary/30 text-sm text-muted-foreground">
            <Info className="h-5 w-5 mr-2 mt-0.5 shrink-0 text-primary" />
            <div>
                Voice commands starting with '<strong>Heggles</strong>' populate the input area on the dashboard. Click the <Brain className="inline-block h-3 w-3 mx-0.5"/> icon to process.
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  <li>Toggle listening: <q><strong>Heggles</strong>{turnOnCmdSuffix}</q> / <q><strong>Heggles</strong>{turnOffCmdSuffix}</q>. (Immediate action)</li>
                  <li>Live snippet recall: <q><strong>Heggles</strong>{recallCmdSuffix}</q>. (Triggers {recordingDurationSeconds}s live recording, then AI processing).</li>
                  <li>Add to shopping list: <q><strong>Heggles</strong>{addShopCmdSuffix} [item]</q>. (Populates input for Brain processing)</li>
                  <li>Add to to-do list: <q><strong>Heggles</strong>{addToDoCmdSuffix} [task]</q>. (Populates input for Brain processing)</li>
                  <li>Set buffer: <q><strong>Heggles</strong>{setBufferCmdSuffix} [e.g., 5 minutes / always on]</q>. (Immediate action)</li>
                  <li>Delete item: <q><strong>Heggles</strong>{deleteItemSuffix} [item/item number X] from [shopping list/to do list]</q>. (Populates input for Brain processing)</li>
                  <li>The Microphone icon button on the dashboard (in Input & Recall card) is for direct dictation into the input area.</li>
                  <li>The Play/Stop icon button (next to Dashboard title in header) is for continuous recording; its transcript also populates the input area when stopped for Brain processing.</li>
                </ul>
            </div>
        </div>
      </CardContent>
    </Card>
  );
}

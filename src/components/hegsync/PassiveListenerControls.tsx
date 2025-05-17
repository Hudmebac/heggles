
"use client";

import { useState, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle, Timer, Info, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';
import { BUFFER_TIME_OPTIONS, LOCALSTORAGE_KEYS, DEFAULT_BUFFER_TIME, RECORDING_DURATION_MS, WAKE_WORDS, type BufferTimeValue } from '@/lib/constants';

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
          } else {
            console.warn("Invalid buffer time value received from storage event:", newBufferTimeValue);
          }
        } catch (e) {
          console.error("Error parsing buffer time from storage event:", e);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [setBufferTime]);


  const handleToggleSwitch = (checked: boolean) => {
    onToggleListening(checked);
  };

  const recordingDurationSeconds = RECORDING_DURATION_MS / 1000;

  const recallCmdSuffix = WAKE_WORDS.RECALL_THOUGHT.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.ADD_TO_SHOPPING_LIST.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const setBufferCmdSuffix = WAKE_WORDS.SET_BUFFER_TIME.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.TURN_LISTENING_ON.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.TURN_LISTENING_OFF.substring(WAKE_WORDS.HEGSYNC_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGSYNC_BASE.length);


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
            Conceptual Buffer Time
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
            The <q><strong>HegSync</strong>{recallCmdSuffix}</q> voice command or the <Mic className="inline-block h-3 w-3 mx-0.5"/> icon button on the dashboard records a {recordingDurationSeconds}-second audio snippet. You can also set this buffer time via voice: <q><strong>HegSync</strong>{setBufferCmdSuffix} [duration]</q>.
          </p>
        </div>

        {showWarning && (
          <div className="flex items-center p-3 border border-yellow-400 bg-yellow-50 text-yellow-700 rounded-md text-sm">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <span>
              Passive listening is active. Audio is being temporarily buffered locally.
            </span>
          </div>
        )}
        <div className="flex items-start p-3 border rounded-lg bg-secondary/30 text-sm text-muted-foreground">
            <Info className="h-5 w-5 mr-2 mt-0.5 shrink-0 text-primary" />
            <div>
                Toggle the switch above or say <q><strong>HegSync</strong>{turnOnCmdSuffix}</q> / <q><strong>HegSync</strong>{turnOffCmdSuffix}</q> to manage passive listening.
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  <li>Say <q><strong>HegSync</strong>{recallCmdSuffix}</q> (or use the <Mic className="inline-block h-3 w-3 mx-0.5"/> icon button on the dashboard) to record a {recordingDurationSeconds}s audio snippet for AI processing.</li>
                  <li>Say <q><strong>HegSync</strong>{addShopCmdSuffix} [item]</q> to add to your shopping list.</li>
                  <li>Say <q><strong>HegSync</strong>{setBufferCmdSuffix} [e.g., 5 minutes / always on]</q> to set the conceptual buffer time.</li>
                  <li>Say <q><strong>HegSync</strong>{deleteItemSuffix} [item/item number X] from [shopping list/to do list]</q> to remove an item.</li>
                </ul>
                 The <Brain className="inline-block h-3 w-3 mx-0.5"/> icon button on the dashboard uses text from the input area.
            </div>
        </div>
      </CardContent>
    </Card>
  );
}



"use client";

import { useState, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle, Info, Brain, PlayCircle, StopCircle } from 'lucide-react'; // Timer icon removed
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
// Select, SelectContent, SelectItem, SelectTrigger, SelectValue removed
// useLocalStorage, BUFFER_TIME_OPTIONS, DEFAULT_BUFFER_TIME removed as direct dependencies for UI
import { LOCALSTORAGE_KEYS, WAKE_WORDS, RECORDING_DURATION_MS } from '@/lib/constants';

interface PassiveListenerControlsProps {
  isListening: boolean;
  onToggleListening: (isListening: boolean) => void;
}

export function PassiveListenerControls({ isListening, onToggleListening }: PassiveListenerControlsProps) {
  const [showWarning, setShowWarning] = useState(false);
  // Removed bufferTime state and useLocalStorage hook for it, as UI is removed from here.

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

  // Removed useEffect that listened to storage changes for bufferTime, as this component no longer displays/sets it.

  const handleToggleSwitch = (checked: boolean) => {
    onToggleListening(checked);
  };

  const recallCmdSuffix = WAKE_WORDS.HEGGLES_REPLAY_THAT.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const addShopCmdSuffix = WAKE_WORDS.HEGGLES_ADD_TO_SHOPPING_LIST_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const addToDoCmdSuffix = WAKE_WORDS.HEGGLES_ADD_TO_TODO_LIST_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const setBufferCmdSuffix = WAKE_WORDS.HEGGLES_SET_BUFFER.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOnCmdSuffix = WAKE_WORDS.HEGGLES_TURN_ON.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const turnOffCmdSuffix = WAKE_WORDS.HEGGLES_TURN_OFF.substring(WAKE_WORDS.HEGGLES_BASE.length);
  const deleteItemSuffix = WAKE_WORDS.DELETE_ITEM_PREFIX.substring(WAKE_WORDS.HEGGLES_BASE.length);
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

        {/* Conceptual Buffer Time Select and description removed from here */}

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
                Voice commands starting with '<strong>Heggles</strong>' usually populate the input area on the dashboard. Click the <Brain className="inline-block h-3 w-3 mx-0.5"/> icon to process.
                The "Conceptual Buffer Time" (used by the 'replay that' voice command) can be configured on the <Button variant="link" asChild className="p-0 h-auto text-sm text-muted-foreground underline"><a href="/settings">Settings page</a></Button>.
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  <li>Toggle listening: <q><strong>Heggles</strong>{turnOnCmdSuffix}</q> / <q><strong>Heggles</strong>{turnOffCmdSuffix}</q>. (Immediate action)</li>
                  <li>Live snippet recall: <q><strong>Heggles</strong>{recallCmdSuffix}</q>. (Triggers {recordingDurationSeconds}s live recording & transcription, then AI processing of that transcript.)</li>
                  <li>Add to shopping list: <q><strong>Heggles</strong>{addShopCmdSuffix} [item] to my shopping list</q>. (Populates input for <Brain className="inline-block h-3 w-3 mx-0.5"/> processing)</li>
                  <li>Add to to-do list: <q><strong>Heggles</strong>{addToDoCmdSuffix} [task] to my to do list</q>. (Populates input for <Brain className="inline-block h-3 w-3 mx-0.5"/> processing)</li>
                  <li>Set buffer: <q><strong>Heggles</strong>{setBufferCmdSuffix} [e.g., 5 minutes / always on]</q>. (Immediate action, updates setting on Settings page)</li>
                  <li>Delete item: <q><strong>Heggles</strong>{deleteItemSuffix} [item/item number X] from [shopping list/to do list]</q>. (Populates input for <Brain className="inline-block h-3 w-3 mx-0.5"/> processing)</li>
                  <li>The <Mic className="inline-block h-3 w-3 mx-0.5"/> icon button on the dashboard (in Input & Recall card) is for direct dictation into the input area.</li>
                  <li>The <PlayCircle className="inline-block h-3 w-3 mx-0.5 text-green-500"/>/<StopCircle className="inline-block h-3 w-3 mx-0.5 text-red-500"/> button (next to Dashboard title) is for continuous recording; its transcript also populates the input area when stopped.</li>
                </ul>
            </div>
        </div>
      </CardContent>
    </Card>
  );
}

    
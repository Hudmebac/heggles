
"use client";

import { useState, useEffect } from 'react';
import { Mic, MicOff, AlertTriangle, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLocalStorage } from '@/lib/hooks/useLocalStorage';

interface PassiveListenerControlsProps {
  isListening: boolean;
  onToggleListening: (isListening: boolean) => void;
}

const bufferTimeOptions = [
  { value: '1', label: '1 Minute' },
  { value: '5', label: '5 Minutes' },
  { value: '15', label: '15 Minutes' },
  { value: '30', label: '30 Minutes' },
  { value: 'continuous', label: 'Always On (Continuous)' },
];

export function PassiveListenerControls({ isListening, onToggleListening }: PassiveListenerControlsProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [bufferTime, setBufferTime] = useLocalStorage<string>('hegsync-buffer-time', '5'); // Default to 5 minutes

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

  const handleToggleSwitch = (checked: boolean) => {
    onToggleListening(checked);
  };
  
  const selectedBufferTimeLabel = bufferTimeOptions.find(opt => opt.value === bufferTime)?.label || `${bufferTime} Minutes`;

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
          <Select value={bufferTime} onValueChange={setBufferTime}>
            <SelectTrigger id="buffer-time-select" aria-label="Select buffer time period">
              <SelectValue placeholder="Select buffer time" />
            </SelectTrigger>
            <SelectContent>
              {bufferTimeOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showWarning && (
          <div className="flex items-center p-3 border border-yellow-400 bg-yellow-50 text-yellow-700 rounded-md text-sm">
            <AlertTriangle className="h-5 w-5 mr-2" />
            <span>
              Passive listening is active. Audio is being temporarily buffered locally.
              This is a simulation; no actual audio is recorded or stored persistently by this demo.
            </span>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Toggle to {isListening ? "disable" : "enable"} passive listening. When active, the app (conceptually) maintains a temporary local audio buffer for the selected period of <span className="font-semibold">{selectedBufferTimeLabel}</span>.
          Use the "Recall Thought" section to process this (simulated) buffered audio.
        </p>
      </CardContent>
    </Card>
  );
}


// src/lib/list-export-utils.ts
"use client";

import type { ShoppingListItem, ToDoListItem, TimePoint } from '@/lib/types';
import * as XLSX from 'xlsx';
import { SHARE_DEFAULTS } from './constants';

const formatTimePointToStringForExport = (timePoint?: TimePoint | null): string => {
  if (!timePoint || !timePoint.period) return '';
  const hInput = timePoint.hh;
  const mInput = timePoint.mm;

  const hVal = (hInput === '' || hInput === null) ? 12 : parseInt(hInput, 10);
  const mVal = (mInput === '' || mInput === null) ? 0 : parseInt(mInput, 10);

  if (isNaN(hVal) || hVal < 1 || hVal > 12 || isNaN(mVal) || mVal < 0 || mVal > 59) {
    if ((hInput === '' || hInput === null) && (mInput === '' || mInput === null) && timePoint.period) {
      return `12:00 ${timePoint.period}`;
    }
    return '';
  }
  return `${String(hVal).padStart(2, '0')}:${String(mVal).padStart(2, '0')} ${timePoint.period}`;
};

const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// --- Shopping List Utilities ---

export const downloadShoppingListTemplate = (format: 'csv' | 'excel' | 'json' | 'text') => {
  if (format === 'csv') {
    const comments = "# This is a template for importing your shopping list.\n" +
                     "# Each row should represent a shopping list item.\n" +
                     "# The first column ('text') is required and should contain the item name.\n" +
                     "# The second column ('completed') is required and should be 'true' or 'false'.\n";
    const header = "text,completed\n";
    const csvContent = comments + header + "Example Item 1,false\nExample Item 2,true\n";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, 'shopping-list_template.csv');
  } else if (format === 'excel') {
    const templateComments = [
      ["# This is an Excel template for importing Shopping List items."],
      ["# Each row starting from row 5 represents a single item."],
      ["#"],
      ["# Column Explanations:"],
      ["# text: The description of the item (required)."],
      ["# completed: Item completion status. Must be 'true' or 'false'."],
      []
    ];
    const header = ["text", "completed"];
    const exampleRows = [
      ["Example Item 1", "false"],
      ["Example Item 2", "true"]
    ];
    const worksheetData = [...templateComments, header, ...exampleRows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 10 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Shopping List Template");
    XLSX.writeFile(workbook, "shopping-list_template.xlsx");
  } else if (format === 'json') {
    const templateData: Omit<ShoppingListItem, 'id'>[] = [ // Use Omit for template
      { text: "Example Item 1 (from JSON template)", completed: false },
      { text: "Example Item 2 (from JSON template)", completed: true },
    ];
    const jsonContent = JSON.stringify(templateData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    triggerDownload(blob, 'shopping-list_template.json');
  } else if (format === 'text') {
    const comments = "# Shopping List Template (Text)\n" +
                     "# Each line represents one shopping item.\n" +
                     "# Lines starting with # are comments and will be ignored during import.\n\n";
    const exampleItems = "Example Item 1\nExample Item 2\n";
    const textContent = comments + exampleItems;
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
    triggerDownload(blob, 'shopping-list_template.txt');
  }
};

export const exportShoppingList = (items: ShoppingListItem[], format: 'csv' | 'json' | 'excel' | 'text', listName: string = "shopping-list") => {
  if (format === 'json') {
    const jsonContent = JSON.stringify(items.map(({id, ...rest}) => rest), null, 2); 
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    triggerDownload(blob, `${listName}.json`);
  } else if (format === 'csv') {
    const headers = ["text", "completed"];
    const csvRows = items.map(item => [
      `"${item.text.replace(/"/g, '""')}"`,
      item.completed ? 'true' : 'false'
    ].join(','));
    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `${listName}.csv`);
  } else if (format === 'excel') {
    const data = items.map(item => ({
      text: item.text,
      completed: item.completed ? 'true' : 'false',
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 10 }];
    worksheet['!autofilter'] = { ref: "A1:B" + (data.length + 1) };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Shopping List");
    XLSX.writeFile(workbook, `${listName}.xlsx`);
  } else if (format === 'text') {
    const textContent = items.map(item => `${item.completed ? '[x] ' : '[ ] '}${item.text}`).join('\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
    triggerDownload(blob, `${listName}.txt`);
  }
};

// --- To-Do List Utilities ---

const formatToDoItemForTextExport = (item: ToDoListItem): string => {
  let line = `${item.completed ? '[x]' : '[ ]'} ${item.text}`;
  if (item.dueDate) {
     try {
      const dateObj = new Date(item.dueDate + 'T00:00:00'); // Ensure date is parsed in local timezone
      line += ` (Due: ${dateObj.toLocaleDateString()})`; 
    } catch (e) {
      line += ` (Due: ${item.dueDate})`; // Fallback
    }
  }
  if (item.timeSettingType && item.timeSettingType !== 'not_set') {
    if (item.timeSettingType === 'all_day') line += ` [All Day]`;
    else if (item.timeSettingType === 'am_period') line += ` [AM]`;
    else if (item.timeSettingType === 'pm_period') line += ` [PM]`;
    else if (item.timeSettingType === 'specific_start' && item.startTime) {
      line += ` [Starts: ${formatTimePointToStringForExport(item.startTime)}]`;
    } else if (item.timeSettingType === 'specific_start_end' && item.startTime && item.endTime) {
      line += ` [Time: ${formatTimePointToStringForExport(item.startTime)} - ${formatTimePointToStringForExport(item.endTime)}]`;
    } else if (item.timeSettingType === 'specific_start_end' && item.startTime) { 
      line += ` [Starts: ${formatTimePointToStringForExport(item.startTime)}]`;
    }
  }
  return line;
};


export const downloadToDoListTemplate = (format: 'csv' | 'excel' | 'json' | 'text') => {
  if (format === 'csv') {
    const comments = `# This is a CSV template for importing To-Do List items.
# Each row represents a single task.
#
# text: The description of the task (required). Use double quotes "" around text containing commas. Escape double quotes within text by doubling them (e.g., "He said ""Hello""").
# completed: Task completion status. Must be 'true' or 'false'.
# timeSettingType: The type of time setting. Accepted values: 'not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'. (Optional, default 'not_set')
# startTime: The start time of the task. Format as "hh:mm AM/PM" (e.g., "09:30 AM", "01:00 PM"). Required if timeSettingType is 'specific_start' or 'specific_start_end'. (Optional)
# endTime: The end time of the task. Format as "hh:mm AM/PM" (e.g., "11:00 AM", "05:00 PM"). Required if timeSettingType is 'specific_start_end'. (Optional)
# dueDate: The due date of the task. Format as "YYYY-MM-DD" (e.g., "2023-10-27"). (Optional)
#
# Example Rows below header:`;
    const header = "text,completed,timeSettingType,startTime,endTime,dueDate\n";
    const exampleRows = `"Task 1, with comma",false,specific_start,09:00 AM,,2023-11-15
"Buy groceries",true,not_set,,,
"Finish report",false,specific_start_end,02:00 PM,05:30 PM,2023-10-31
`;
    const csvContent = comments + '\n' + header + exampleRows;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, 'todo-list_template.csv');
  } else if (format === 'excel') {
    const templateComments = [
      ["# This is an Excel template for importing To-Do List items."],
      ["# Each row starting from row 11 represents a single task."],
      ["#"],
      ["# Column Explanations:"],
      ["# text: The description of the task (required)."],
      ["# completed: Task completion status. Must be 'true' or 'false'."],
      ["# timeSettingType: The type of time setting. Accepted values: 'not_set', 'all_day', 'am_period', 'pm_period', 'specific_start', 'specific_start_end'. (Optional, default 'not_set')"],
      ["# startTime: The start time of the task. Format as 'hh:mm AM/PM' (e.g., '09:30 AM', '01:00 PM'). Required if timeSettingType is 'specific_start' or 'specific_start_end'. (Optional)"],
      ["# endTime: The end time of the task. Format as 'hh:mm AM/PM' (e.g., '11:00 AM', '05:00 PM'). Required if timeSettingType is 'specific_start_end'. (Optional)"],
      ["# dueDate: The due date of the task. Format as 'YYYY-MM-DD' (e.g., '2023-10-27'). (Optional)"],
      [] 
    ];
    const header = ["text", "completed", "timeSettingType", "startTime", "endTime", "dueDate"];
    const exampleRows = [
      ["Task 1, with comma", "false", "specific_start", "09:00 AM", "", "2023-11-15"],
      ["Buy groceries", "true", "not_set", "", "", ""],
      ["Finish report", "false", "specific_start_end", "02:00 PM", "05:30 PM", "2023-10-31"]
    ];
    const worksheetData = [...templateComments, header, ...exampleRows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    worksheet['!cols'] = [ { wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 } ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "To-Do List Template");
    XLSX.writeFile(workbook, "todo-list_template.xlsx");
  } else if (format === 'json') {
    const templateData: Omit<ToDoListItem, 'id'>[] = [ // Use Omit for template
      { text: "Example To-Do 1 (from JSON template)", completed: false, timeSettingType: 'specific_start', startTime: { hh: '09', mm: '30', period: 'AM' }, endTime: null, dueDate: "2024-12-01" },
      { text: "Example To-Do 2 (from JSON template)", completed: true, timeSettingType: 'all_day', startTime: null, endTime: null, dueDate: "2024-11-15" },
    ];
    const jsonContent = JSON.stringify(templateData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    triggerDownload(blob, 'todo-list_template.json');
  } else if (format === 'text') {
    const comments = "# To-Do List Template (Text)\n" +
                     "# Each line represents one task.\n" +
                     "# For import, only the task description is read. Completion, dates, and times are not imported from .txt files.\n" +
                     "# Lines starting with # are comments.\n\n";
    const exampleItems = "Example Task 1\nExample Task 2 [Due: 2024-12-31]\n";
    const textContent = comments + exampleItems;
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
    triggerDownload(blob, 'todo-list_template.txt');
  }
};

export const exportToDoList = (items: ToDoListItem[], format: 'csv' | 'json' | 'excel' | 'text', listName: string = "todo-list") => {
  if (format === 'json') {
    const jsonContent = JSON.stringify(items.map(({id, ...rest}) => rest), null, 2); 
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    triggerDownload(blob, `${listName}.json`);
  } else if (format === 'csv') {
    const headers = ["text", "completed", "timeSettingType", "startTime", "endTime", "dueDate"];
    const csvRows = items.map(item => [
      `"${item.text.replace(/"/g, '""')}"`,
      item.completed ? 'true' : 'false',
      item.timeSettingType || '',
      formatTimePointToStringForExport(item.startTime),
      formatTimePointToStringForExport(item.endTime),
      item.dueDate || '',
    ].join(','));
    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `${listName}.csv`);
  } else if (format === 'excel') {
    const data = items.map(item => ({
      text: item.text,
      completed: item.completed ? 'true' : 'false',
      timeSettingType: item.timeSettingType || '',
      startTime: formatTimePointToStringForExport(item.startTime),
      endTime: formatTimePointToStringForExport(item.endTime),
      dueDate: item.dueDate || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [ { wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 } ];
    worksheet['!autofilter'] = { ref: "A1:F" + (data.length + 1) };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "To-Do List");
    XLSX.writeFile(workbook, `${listName}.xlsx`);
  } else if (format === 'text') {
    const textContent = items.map(item => formatToDoItemForTextExport(item)).join('\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
    triggerDownload(blob, `${listName}.txt`);
  }
};

// --- Sharing Utilities ---

export const getShareFooterText = (isHtml: boolean): string => {
  return isHtml ? SHARE_DEFAULTS.FOOTER_TEXT_HTML : SHARE_DEFAULTS.FOOTER_TEXT_PLAIN;
};

export const generateShoppingListPlainTextForShare = (items: ShoppingListItem[], includeFooter: boolean = true): string => {
  let content = "My Shopping List from Heggles:\n\n";
  content += items.map(item => `${item.completed ? '✅' : '◻️'} ${item.text}`).join('\n');
  if (includeFooter) {
    content += `\n\n${getShareFooterText(false)}`;
  }
  return content;
};

export const generateToDoListPlainTextForShare = (items: ToDoListItem[], includeFooter: boolean = true): string => {
  let content = "My To-Do List from Heggles:\n\n";
  content += items.map(item => formatToDoItemForPlainTextShare(item)).join('\n');
  if (includeFooter) {
    content += `\n\n${getShareFooterText(false)}`;
  }
  return content;
};

// Helper to format date/time for ICS: YYYYMMDD or YYYYMMDDTHHMMSS
const formatICSDate = (date: Date, includeTime: boolean = false): string => {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  if (!includeTime) {
    return `${year}${month}${day}`;
  }
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
};

export const generateToDoListICS = (items: ToDoListItem[]): string => {
  const events = items.filter(item => item.dueDate && !item.completed);
  if (events.length === 0) return "";

  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Heggles//${SHARE_DEFAULTS.TODO_LIST_EMAIL_SUBJECT}//EN`,
    'CALSCALE:GREGORIAN',
  ];

  const nowTimestamp = formatICSDate(new Date(), true);

  events.forEach(item => {
    const uid = `${item.id}@heggles.app`;
    const summary = item.text;
    const dtstamp = nowTimestamp; 

    let dtstartStr: string;
    let dtendStr: string | null = null;

    const dueDateObj = new Date(item.dueDate + 'T00:00:00'); // Use local midnight as reference

    if (item.timeSettingType === 'all_day' || (!item.startTime && item.timeSettingType !== 'specific_start' && item.timeSettingType !== 'specific_start_end')) {
      dtstartStr = `DTSTART;VALUE=DATE:${formatICSDate(dueDateObj)}`;
      // For all-day events, DTEND is typically the start of the next day if a duration is implied.
      // Or can be omitted if it's a single day event with no specific end.
      // For simplicity, we'll make it a single-day event.
    } else {
      let startHours = 0;
      let startMinutes = 0;

      if (item.startTime) {
        startHours = parseInt(item.startTime.hh, 10);
        startMinutes = parseInt(item.startTime.mm, 10);
        if (item.startTime.period === 'PM' && startHours < 12) startHours += 12;
        if (item.startTime.period === 'AM' && startHours === 12) startHours = 0; // Midnight
      } else if (item.timeSettingType === 'am_period') {
        startHours = 9; // Default AM start e.g. 9 AM
      } else if (item.timeSettingType === 'pm_period') {
        startHours = 13; // Default PM start e.g. 1 PM
      }
      // Else, if specific_start without startTime, it's effectively 00:00

      const startDate = new Date(Date.UTC(dueDateObj.getUTCFullYear(), dueDateObj.getUTCMonth(), dueDateObj.getUTCDate(), startHours, startMinutes));
      dtstartStr = `DTSTART:${formatICSDate(startDate, true)}`;

      if (item.timeSettingType === 'specific_start_end' && item.endTime) {
        let endHours = parseInt(item.endTime.hh, 10);
        let endMinutes = parseInt(item.endTime.mm, 10);
        if (item.endTime.period === 'PM' && endHours < 12) endHours += 12;
        if (item.endTime.period === 'AM' && endHours === 12) endHours = 0;

        const endDate = new Date(Date.UTC(dueDateObj.getUTCFullYear(), dueDateObj.getUTCMonth(), dueDateObj.getUTCDate(), endHours, endMinutes));
        // If end time is before or same as start time, assume it's on the next day or adjust (simple: add 1 hr from start)
        if (endDate <= startDate) {
             endDate.setTime(startDate.getTime() + (60 * 60 * 1000)); // Default 1 hour duration
        }
        dtendStr = `DTEND:${formatICSDate(endDate, true)}`;
      } else {
        // Default duration: 1 hour if only start time is specified, or if it's just AM/PM
        const endDate = new Date(startDate.getTime() + (60 * 60 * 1000));
        dtendStr = `DTEND:${formatICSDate(endDate, true)}`;
      }
    }

    icsContent.push('BEGIN:VEVENT');
    icsContent.push(`UID:${uid}`);
    icsContent.push(`SUMMARY:${summary.replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n')}`);
    icsContent.push(`DTSTAMP:${dtstamp}`);
    icsContent.push(dtstartStr);
    if (dtendStr) {
      icsContent.push(dtendStr);
    }
    // Optionally add more fields like DESCRIPTION, LOCATION, etc.
    icsContent.push('END:VEVENT');
  });

  icsContent.push('END:VCALENDAR');
  return icsContent.join('\r\n');
};

// Function to trigger ICS file download
export const downloadICSFile = (icsContent: string, filename: string = "todo_calendar.ics") => {
  if (!icsContent) return;
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
  triggerDownload(blob, filename);
};


// src/lib/list-export-utils.ts
"use client";

import type { ShoppingListItem, ToDoListItem, TimePoint } from '@/lib/types';
import * as XLSX from 'xlsx';

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

// --- Shopping List Utilities ---

export const downloadShoppingListTemplate = (format: 'csv' | 'excel') => {
  if (format === 'csv') {
    const comments = "# This is a template for importing your shopping list.\n" +
                     "# Each row should represent a shopping list item.\n" +
                     "# The first column ('text') is required and should contain the item name.\n" +
                     "# The second column ('completed') is required and should be 'true' or 'false'.\n";
    const header = "text,completed\n";
    const csvContent = comments + header + "Example Item 1,false\nExample Item 2,true\n";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'shopping-list_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
  }
};

export const exportShoppingList = (items: ShoppingListItem[], format: 'csv' | 'json' | 'excel', listName: string = "shopping-list") => {
  if (format === 'json') {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(items, null, 2));
    const link = document.createElement('a');
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `${listName}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else if (format === 'csv') {
    const headers = ["text", "completed"];
    const csvRows = items.map(item => [
      `"${item.text.replace(/"/g, '""')}"`,
      item.completed ? 'true' : 'false'
    ].join(','));
    const csvContent = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${listName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
  }
};

// --- To-Do List Utilities ---

export const downloadToDoListTemplate = (format: 'csv' | 'excel') => {
  if (format === 'csv') {
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
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else if (format === 'excel') {
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
    worksheet['!cols'] = [ { wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 12 } ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "To-Do List Template");
    XLSX.writeFile(workbook, "todo-list_template.xlsx");
  }
};

export const exportToDoList = (items: ToDoListItem[], format: 'csv' | 'json' | 'excel', listName: string = "todo-list") => {
  if (format === 'json') {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(items, null, 2));
    const link = document.createElement('a');
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `${listName}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${listName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
  }
};

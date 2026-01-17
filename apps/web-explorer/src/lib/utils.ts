import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * UTILITY FUNCTIONS
 */

// ===================================
// STYLING
// ===================================

// Add clsx and resolve tailwind conflicts
// eg: className={cn( isDisabled && 'opacity-50' )}
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ===================================
// FILE FORMATTING
// ===================================

/**
 * Converts bytes to file sizes
 * eg: 1572864bytes -> 1.5MB
 * @param bytes takes it as input
 * @param decimals outputs in 2 decimal points
 * @returns the file size output
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  // Zero case
  if (bytes === 0) return '0 Bytes';
  
  // The byte multiplier 
  const k = 1024;
  // for converting to decimal points
  const dm = decimals < 0 ? 0 : decimals;
  // Available sizes traversed by i
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  
  // Extract the power 
  // Round it off as a whole number
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  // Convert to desired size returned upto 2 decimal points
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Format the files
// eg: <p>{formatFileSize(file.size)}</p>
export function formatFileSize(sizeBytes: number): string {
  return formatBytes(sizeBytes);
}


// ===================================
// DATE FORMATTING
// ===================================

// Dates come like 2025-01-14T10:24:11.234Z
// converts to -> Jan 14, 2025
export function formatDate(date: string | Date): string {
  // Generate a date
  const d = new Date(date);

  // Modify the date
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Returns Jan 14, 2025, 10:24 AM
export function formatDateTime(date: string | Date): string {
  const d = new Date(date);

  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}



/** 
 * @param date The date item was published
 * @returns The time relative to it
 * eg: 5m ago, Just now, 4hours ago
 */
export function formatRelativeTime(date: string | Date): string {

  // Generate current date
  const now = new Date();
  // Fetch the previous date 
  const past = new Date(date);
  // Count the difference between them
  const diffMs = now.getTime() - past.getTime();
  
  // Extract the exact time
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  // Return based on relative time passed
  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return formatDate(date);
}


// ===================================
// NUMBER FORMATTING
// ===================================

// Adds the extra commas in between
// eg: 1000000 -> 1,000,000
export function formatNumber(num: number, decimals: number = 0): string {

  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// We format percentages 
// eg: 87.345 -> 87.5%
export function formatPercentage(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Use the browser to fetch the currency symbol
 * @param amount 
 * @param currency 
 * @returns the formatted currency
 * eg: 1234.5 -> $1,234.50
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(amount);
}

// ===================================
// FILE VALIDATION
// ===================================

// Define the type
export interface FileValidation {
  valid: boolean;
  error?: string;
}

/**
 * Verify the file size
 * 
 * @param sizeBytes the size of the original file
 * @param maxSizeGB the max allowed size
 * @returns boolean
 */
export function validateFileSize(
  sizeBytes: number,
  maxSizeGB: number = 50
): FileValidation {

  // Max allowed size is 50GB
  const maxBytes = maxSizeGB * 1024 * 1024 * 1024;
  
  if (sizeBytes === 0) {
    return { valid: false, error: 'File is empty' };
  }
  
  // Too big 
  if (sizeBytes > maxBytes) {
    return {
      valid: false,
      error: `File too large (${formatBytes(sizeBytes)}). Maximum: ${maxSizeGB}GB`,
    };
  }
  
  return { valid: true };
}

// Validate file name 
export function validateFileName(fileName: string): FileValidation {
  // The file must have a name 
  if (!fileName || fileName.trim().length === 0) {
    return { valid: false, error: 'File name is required' };
  }
  
  // Too big
  if (fileName.length > 255) {
    return { valid: false, error: 'File name too long (max 255 characters)' };
  }
  
  // Check for invalid characters
  const invalidChars = /[<>:"|?*]/g;
  if (invalidChars.test(fileName)) {
    return { valid: false, error: 'File name contains invalid characters' };
  }
  
  return { valid: true };
}

// ===================================
// STATUS HELPERS
// ===================================

// We wish to directly fetch the colors based on status so multiple redundant definitions don't have to be made
// Directly fetch the file color based on the status
export function getFileStatusColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'UPLOADING':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'DEGRADED':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'DELETED':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

// Repeat the logic for the chunk
export function getChunkStatusColor(status: string): string {
  switch (status) {
    case 'HEALTHY':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'REPLICATING':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'DEGRADED':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'LOST':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'PENDING':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

// And for the devices
export function getDeviceStatusColor(status: string): string {
  switch (status) {
    case 'ONLINE':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'OFFLINE':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    case 'SUSPENDED':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

// ===================================
// ERROR HANDLING
// ===================================

// Format the error message
export function getErrorMessage(error: any): string {

  // Return it directly 
  if (typeof error === 'string') return error;
  // Standard error our backend gives
  if (error?.response?.data?.error) return error.response.data.error;

  // Standard JS error message
  if (error?.message) return error.message;
  return 'An unexpected error occurred';
}

// ===================================
// CLIPBOARD
// ===================================

// Aid the user with UX while copying
// takes help of the browser to copy IDs, Hashes, API keys
export async function copyToClipboard(text: string): Promise<boolean> {
  try {

    // Use browser's clipboard
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}

// ===================================
// DOWNLOAD HELPERS
// ===================================

// This is the amazing way of creating a fake link and clicking instantly to download a file from the browser 
// This has been implemented in our API
export function downloadJSON(data: any, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}



/**
 * Download a CSV file
 * Prints a table our of our object
 * @param data array of objects
 * @param filename the input file name
 * @returns downloads the file
 * 
 * eg: id,name,email
 * 1,Alice,alice@example.com
 * 2,Bob,bob@example.com
 */
export function downloadCSV(data: any[], filename: string): void {

  if (data.length === 0) return;
  
  // Collect the keys as they become the headers of our table
  const headers = Object.keys(data[0]);

  // Form the csv file 
  const csv = [

    // Separate the headers of tables in separate columns
    headers.join(','),

    // Loop through each object
    // FOr every row put the value below the header 
    ...data.map(row => headers.map(h => row[h]).join(',')),

    // Finally put all values into a new line
  ].join('\n');
  
  // Turn the csv text into a file 
  // Defile it's MIME type
  const blob = new Blob([csv], { type: 'text/csv' });
  // Create a URL 
  const url = URL.createObjectURL(blob);
  
  // Download the ghost link
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ===================================
// DEBOUNCE
// ===================================


/**
 * The debounce function used to delay function requests
 * 
 * @param func the input function which needs delay
 * @param wait the amount of time delay
 * @returns the executed function after delay
 */
// The T extends means the type of the given function are extended
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {

  // Declare timeout
  // Works outside executedFunction() due to closure
  let timeout: NodeJS.Timeout | null = null;
  
  // This runs every time on new input
  // It takes the arguments from the browser 
  // eg: When user types I 
  //     args = 'I'
  return function executedFunction(...args: Parameters<T>) {

    // This is the code that run if the timer reaches it's end
    const later = () => {
      // set the timeout back to start
      timeout = null;
      // Call the original function with the full argument
      func(...args);
    };
    
    // The reset button
    // It clears the previous running timer
    // eg: 1. If it has been only 200ms and
    //     2. The function is called again then -> the timeout is renewed and new timeout gets initiated
    if (timeout) clearTimeout(timeout);

    // Start a brand new timer for the function given to us 
    timeout = setTimeout(later, wait);
  };
}
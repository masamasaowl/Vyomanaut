import winston from 'winston';
import path from 'path';
import { config } from '../config/env';
import fs from 'fs';

/**
 * Winston Logger Configuration
 * 
 * Logs to:
 * - Console (development)
 * - Files (production)
 * - Error file (errors only)
 * 
 * Format:
 * [2024-12-24 10:30:45] INFO: User registered: john@example.com
 */

const logFormat = winston.format.combine(

  // time: 2024-12-24 10:30:45  
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),

  // errors have their stack trace included
  winston.format.errors({ stack: true }),


  // The final appearance of the log
  // ex: [2024-12-24 10:30:45] INFO: User registered {"userId":123}
  winston.format.printf(({ timestamp, level, message, ...meta }) => {

    // Makes the log prettier by uppercase level
    let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    // Add metadata if exists
    if (Object.keys(meta).length > 0) {

      // Append the extra info
      log += ` ${JSON.stringify(meta)}`;
    }
    
    return log;
  })
);


// Define the log file path
const logsDir = path.join(process.cwd(), 'logs');
// Create logs directory if it doesn't exist
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}


// Create the logger 
export const logger = winston.createLogger({

  // For development the debug logs also get printed
  level: config.isDevelopment ? 'debug' : 'info',

  // Attach the format
  format: logFormat,

  // Where all do we store our logs
  transports: [

    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),

      // only 10MB
      maxsize: 10485760, 
      // Keep last 5 log files delete the rest
      maxFiles: 5,
    }),
    

    // Write errors to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),

      // Define that only error logs need to be store here
      level: 'error',
      maxsize: 10485760,
      maxFiles: 10,
    }),
    
    // In development we also console the logs
    ...(config.isDevelopment
      ? [
        // Logs need to shoe on console
          new winston.transports.Console({

            format: winston.format.combine(
               // Make them pretty 
              winston.format.colorize(),
              // Only info: Server started
              winston.format.simple()
            ),
          }),
        ]

        // Else nothing happens
      : []),
  ],
});

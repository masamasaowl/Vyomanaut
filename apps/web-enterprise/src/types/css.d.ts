// We were facing a TS error while importing the globals.css side effect import 
// So we declare to TS that .css imports are safe 
declare module '*.css';
declare module '*.scss';
declare module '*.sass';

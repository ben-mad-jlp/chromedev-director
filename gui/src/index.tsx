import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';

/**
 * Main application entry point
 *
 * Sets up:
 * - BrowserRouter for client-side routing
 * - Global styles (Tailwind via index.css)
 * - React StrictMode for development checks
 * - App component with initialization
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { installNativeDialogOverrides } from './lib/nativeDialogOverride';
import { ToastProvider } from './components/ToastProvider';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

installNativeDialogOverrides();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

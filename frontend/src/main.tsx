import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import SecureApp from './SecureApp';
import './styles.css';
import './responsive.css';
import './tablet.css';
import './open-finance.css';
import './auth.css';

createRoot(document.getElementById('root')!).render(<StrictMode><SecureApp /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/service-worker.js'); });
}

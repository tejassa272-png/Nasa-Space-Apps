import { createRoot } from 'react-dom/client';
import App from './App';
import BackgroundVideo from './BackgroundVideo';
import './index.css';
import './theme.css';

const container = document.getElementById('root');
if (!container) throw new Error('AstroTwin root element is missing.');

createRoot(container).render(
  <>
    <BackgroundVideo />
    <App />
  </>,
);

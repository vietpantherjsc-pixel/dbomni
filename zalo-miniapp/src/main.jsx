import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { hydrateStorage } from './utils/storage';

// Spec P4-P5: nạp storage (zmp-sdk nativeStorage trong Zalo) trước khi render
hydrateStorage().finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
});

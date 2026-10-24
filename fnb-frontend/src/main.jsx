import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './utils/api' // Audit 2026-10-21 🟠6: nạp sớm để đăng ký interceptor gắn token cho axios trước mọi render
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

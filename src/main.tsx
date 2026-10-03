import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { isNativeApp } from './haptics'
import './styles.css'
import './dearest.css'
import './haptics.css'
document.documentElement.classList.toggle('native-app', isNativeApp())
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
if (!isNativeApp() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}) })
}

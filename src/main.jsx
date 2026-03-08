import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './client/index.css'
import Landing from './client/Landing.jsx'
import Grid from './client/Grid.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/view" element={<Grid />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Landing from './Landing.jsx'
import Grid from './Grid.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Landing />
    <Grid />
  </StrictMode>,
)

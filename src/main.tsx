import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { warmupFaceLandmarker } from './face/landmarker';
import { warmupGazeEstimator } from './gaze/l2cs';

void warmupFaceLandmarker();
void warmupGazeEstimator();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

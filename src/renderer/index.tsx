import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

console.log('Renderer starting...');

// 간단한 테스트 컴포넌트
const TestApp = () => {
  console.log('TestApp rendering...');
  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: '#f0f0f0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Arial, sans-serif'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        textAlign: 'center'
      }}>
        <h1 style={{ color: '#333', marginBottom: '20px' }}>🎉 React 앱이 정상 작동합니다!</h1>
        <p style={{ color: '#666', marginBottom: '20px' }}>Streamer Alarm System</p>
        <button 
          style={{
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '16px'
          }}
          onClick={() => alert('버튼 클릭 테스트 성공!')}
        >
          테스트 버튼
        </button>
      </div>
    </div>
  );
};

// React 18의 createRoot 사용
const container = document.getElementById('root');
if (!container) {
  console.error('Root container not found');
  throw new Error('Root container not found');
}

console.log('Creating root...');
const root = createRoot(container);

console.log('Rendering app...');
root.render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);

// 개발 환경에서 핫 리로드 지원
if (process.env.NODE_ENV === 'development') {
  // HMR 지원
}
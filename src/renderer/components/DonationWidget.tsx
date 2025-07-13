import React, { useState } from 'react';

interface DonationWidgetProps {
  className?: string;
}

// QR 코드 이미지 컴포넌트 (견고한 에러 처리)
const QRCodeImage: React.FC = () => {
  const [imageError, setImageError] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  
  // 다양한 경로 시도 순서 (개발/프로덕션 환경 모두 고려)
  const imagePaths = [
    // 개발 모드 경로들
    './assets/qr.png',
    'assets/qr.png',
    '../assets/qr.png',
    '../../assets/qr.png',
    // 프로덕션 모드 경로들  
    'resources/assets/qr.png',
    './resources/assets/qr.png',
    // asar 패키징된 경로
    '../assets/qr.png',
    // 최후의 수단: base64 인코딩된 이미지로 대체할 수도 있음
  ];
  
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const currentSrc = e.currentTarget.src;
    console.warn(`QR 이미지 로드 실패: ${currentSrc}`);
    
    const nextAttempt = attemptCount + 1;
    if (nextAttempt < imagePaths.length) {
      setAttemptCount(nextAttempt);
      console.log(`다음 경로 시도 (${nextAttempt + 1}/${imagePaths.length}): ${imagePaths[nextAttempt]}`);
    } else {
      console.error('모든 QR 이미지 경로 실패, 폴백 UI 표시');
      setImageError(true);
    }
  };
  
  const handleImageLoad = () => {
    console.log('✅ QR 이미지 로드 성공:', imagePaths[attemptCount]);
  };
  
  if (imageError) {
    return (
      <div className="w-32 h-32 rounded-lg bg-gray-700/50 border border-gray-600 flex items-center justify-center">
        <div className="text-center p-2">
          <div className="text-3xl mb-2">📱</div>
          <div className="text-xs text-gray-300 font-medium">QR 코드</div>
          <div className="text-xs text-gray-500 mt-1">
            <a 
              href="http://aq.gy/f/Jf1nN" 
              onClick={(e) => {
                e.preventDefault();
                if (window.electronAPI?.openExternal) {
                  window.electronAPI.openExternal('http://aq.gy/f/Jf1nN');
                }
              }}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              직접 링크 열기
            </a>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <img 
      key={attemptCount} // key를 변경해서 React가 새 이미지 요소를 생성하도록 함
      src={imagePaths[attemptCount]} 
      alt="기부 QR 코드"
      className="w-32 h-32 rounded-lg object-contain bg-white"
      onError={handleImageError}
      onLoad={handleImageLoad}
    />
  );
};

const DonationWidget: React.FC<DonationWidgetProps> = ({ className }) => {
  const [showQR, setShowQR] = useState(false);
  const donationLink = 'http://aq.gy/f/Jf1nN';

  const handleDonationClick = () => {
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(donationLink);
    } else {
      console.warn('electronAPI.openExternal not available');
    }
  };

  const handleQRToggle = () => {
    setShowQR(!showQR);
  };

  return (
    <div className={`donation-widget ${className || ''}`}>
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-300 mb-1">개발자 후원</h3>
        <p className="text-xs text-gray-400">
          이 앱이 도움이 되셨다면 개발자에게 커피 한 잔 후원해주세요!
        </p>
      </div>
      
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-lg p-4 space-y-3">
        {/* 기부 버튼 */}
        <button
          onClick={handleDonationClick}
          className="w-full bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-primary-500/25 flex items-center justify-center space-x-2"
        >
          <span>💖</span>
          <span>개발자에게 커피 한 잔 후원하기</span>
        </button>

        {/* QR 코드 토글 버튼 */}
        <button
          onClick={handleQRToggle}
          className="w-full bg-gray-700/50 hover:bg-gray-600/50 border border-gray-600/50 hover:border-gray-500/50 text-gray-300 py-2 px-4 rounded-lg transition-all duration-200 backdrop-blur-sm flex items-center justify-center space-x-2"
        >
          <span>📱</span>
          <span>{showQR ? 'QR 코드 숨기기' : 'QR 코드 보기'}</span>
        </button>

        {/* QR 코드 이미지 */}
        {showQR && (
          <div className="flex flex-col items-center space-y-2 pt-2">
            <div className="bg-white/10 backdrop-blur-sm border border-gray-600/50 rounded-lg p-3">
              <QRCodeImage />
            </div>
            <p className="text-xs text-gray-400 text-center">
              모바일로 QR 코드를 스캔하세요
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DonationWidget;
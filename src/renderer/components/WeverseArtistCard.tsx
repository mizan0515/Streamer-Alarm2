import React, { useState } from 'react';
import { WeverseArtist } from '@shared/types';

interface WeverseArtistCardProps {
  artist: WeverseArtist;
  onToggle: (artistName: string, isEnabled: boolean) => Promise<void>;
  disabled?: boolean;
}

const WeverseArtistCard: React.FC<WeverseArtistCardProps> = ({
  artist,
  onToggle,
  disabled = false
}) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      await onToggle(artist.artistName, !artist.isEnabled);
    } catch (error) {
      console.error('Failed to toggle artist:', error);
      alert('아티스트 설정 변경에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`card transition-all duration-300 ${
      artist.isEnabled 
        ? 'ring-2 ring-purple-500' 
        : ''
    }`}>
      <div className="card-body">
        
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* 프로필 이미지 */}
            <div className="relative">
              {artist.profileImageUrl ? (
                <img
                  src={artist.profileImageUrl}
                  alt={`${artist.artistName} 프로필`}
                  className="w-12 h-12 rounded-full object-cover border-2 border-white/20 shadow-md"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const fallback = target.nextElementSibling as HTMLElement;
                    if (fallback) {
                      fallback.classList.remove('hidden');
                    }
                  }}
                />
              ) : null}
              
              {/* 기본 아이콘 (프로필 이미지가 없거나 로드 실패 시) */}
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl bg-gradient-to-br from-purple-600 to-purple-800 border-2 border-white/20 shadow-md ${artist.profileImageUrl ? 'hidden' : ''}`}>
                🎵
              </div>
              
              {/* 활성 상태 표시 */}
              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs border-2 border-white/30 ${
                artist.isEnabled ? 'bg-green-500' : 'bg-gray-500'
              }`}>
                {artist.isEnabled ? '✓' : '✗'}
              </div>
            </div>

            {/* 아티스트 정보 */}
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <h3 className="font-semibold text-white">{artist.artistName}</h3>
                <span className="text-sm text-purple-400">
                  🎵 Weverse
                </span>
              </div>
              
              {/* 상태 표시 */}
              <p className="text-sm text-gray-400 mt-1">
                {artist.isEnabled ? '알림 활성화됨' : '알림 비활성화됨'}
              </p>
            </div>
          </div>

          {/* 토글 스위치 */}
          <div className="flex items-center space-x-3">
            <button
              onClick={handleToggle}
              disabled={disabled || isLoading}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
                artist.isEnabled 
                  ? 'bg-purple-600' 
                  : 'bg-gray-600'
              } ${disabled || isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  artist.isEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            
            {isLoading && (
              <div className="text-sm text-gray-400">
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeverseArtistCard;
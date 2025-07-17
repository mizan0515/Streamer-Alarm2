import React, { useState, useEffect } from 'react';
import { WeverseArtist } from '@shared/types';
import WeverseArtistCard from './WeverseArtistCard';

interface WeverseArtistManagementProps {
  artists: WeverseArtist[];
  needWeverseLogin: boolean;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onToggleArtist: (artistName: string, isEnabled: boolean) => Promise<void>;
}

const WeverseArtistManagement: React.FC<WeverseArtistManagementProps> = ({
  artists,
  needWeverseLogin,
  onLogin,
  onLogout,
  onRefresh,
  onToggleArtist
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);

  const handleLogin = async () => {
    setLoginLoading(true);
    try {
      await onLogin();
    } catch (error) {
      console.error('Failed to login to Weverse:', error);
      alert('위버스 로그인에 실패했습니다.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('위버스에서 로그아웃하시겠습니까?')) {
      return;
    }
    
    setLoginLoading(true);
    try {
      await onLogout();
    } catch (error) {
      console.error('Failed to logout from Weverse:', error);
      alert('위버스 로그아웃에 실패했습니다.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshLoading(true);
    try {
      await onRefresh();
    } catch (error) {
      console.error('Failed to refresh artists:', error);
      alert('아티스트 목록 새로고침에 실패했습니다.');
    } finally {
      setRefreshLoading(false);
    }
  };

  const handleToggleArtist = async (artistName: string, isEnabled: boolean) => {
    setIsLoading(true);
    try {
      await onToggleArtist(artistName, isEnabled);
    } catch (error) {
      console.error('Failed to toggle artist:', error);
      alert('아티스트 설정 변경에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const activeArtists = artists.filter(a => a.isEnabled);
  const inactiveArtists = artists.filter(a => !a.isEnabled);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-white flex items-center">
            <span className="mr-2">🎵</span>
            위버스 아티스트 관리
          </h2>
          <p className="text-gray-400">
            위버스 아티스트 알림을 설정하고 관리하세요
          </p>
        </div>
        
        <div className="flex items-center space-x-3">
          {!needWeverseLogin && (
            <button
              onClick={handleRefresh}
              disabled={refreshLoading || isLoading}
              className="btn btn-secondary"
            >
              {refreshLoading ? (
                <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <span className="mr-2">🔄</span>
              )}
              새로고침
            </button>
          )}
          
          {needWeverseLogin ? (
            <button
              onClick={handleLogin}
              disabled={loginLoading}
              className="btn btn-primary"
            >
              {loginLoading ? (
                <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <span className="mr-2">🔐</span>
              )}
              위버스 로그인
            </button>
          ) : (
            <button
              onClick={handleLogout}
              disabled={loginLoading}
              className="btn btn-secondary"
            >
              {loginLoading ? (
                <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <span className="mr-2">🚪</span>
              )}
              로그아웃
            </button>
          )}
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">전체 아티스트</p>
                <p className="text-2xl font-bold text-white mt-1">{artists.length}</p>
              </div>
              <div className="text-2xl">🎵</div>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">활성 아티스트</p>
                <p className="text-2xl font-bold text-purple-400 mt-1">{activeArtists.length}</p>
              </div>
              <div className="text-2xl">🔔</div>
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400">로그인 상태</p>
                <p className={`text-2xl font-bold mt-1 ${needWeverseLogin ? 'text-red-400' : 'text-green-400'}`}>
                  {needWeverseLogin ? '미로그인' : '로그인됨'}
                </p>
              </div>
              <div className="text-2xl">{needWeverseLogin ? '🔐' : '✅'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 아티스트 목록 */}
      {needWeverseLogin ? (
        <div className="text-center py-16">
          <div className="text-8xl mb-6">🔐</div>
          <h3 className="text-2xl font-semibold text-white mb-3">
            위버스 로그인이 필요합니다
          </h3>
          <p className="text-lg text-gray-400 mb-8 max-w-md mx-auto">
            아티스트 목록을 불러오고 알림을 받으려면 위버스에 로그인해주세요
          </p>
          <button
            onClick={handleLogin}
            disabled={loginLoading}
            className="btn btn-primary btn-lg"
          >
            {loginLoading ? (
              <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <span className="mr-2">🔐</span>
            )}
            위버스 로그인
          </button>
        </div>
      ) : artists.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-8xl mb-6">🎵</div>
          <h3 className="text-2xl font-semibold text-white mb-3">
            팔로우된 아티스트가 없습니다
          </h3>
          <p className="text-lg text-gray-400 mb-8 max-w-md mx-auto">
            위버스에서 아티스트를 팔로우한 후 새로고침 버튼을 눌러주세요
          </p>
          <button
            onClick={handleRefresh}
            disabled={refreshLoading}
            className="btn btn-primary btn-lg"
          >
            {refreshLoading ? (
              <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <span className="mr-2">🔄</span>
            )}
            아티스트 목록 새로고침
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 활성 아티스트 */}
          {activeArtists.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-white flex items-center">
                <span className="mr-2">🔔</span>
                활성 아티스트 ({activeArtists.length}명)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeArtists.map(artist => (
                  <WeverseArtistCard
                    key={artist.id}
                    artist={artist}
                    onToggle={handleToggleArtist}
                    disabled={isLoading}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 비활성 아티스트 */}
          {inactiveArtists.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-white flex items-center">
                <span className="mr-2">🔕</span>
                비활성 아티스트 ({inactiveArtists.length}명)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {inactiveArtists.map(artist => (
                  <WeverseArtistCard
                    key={artist.id}
                    artist={artist}
                    onToggle={handleToggleArtist}
                    disabled={isLoading}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WeverseArtistManagement;
import React, { useState } from 'react';
import { WeverseArtist } from '@shared/types';
import WeverseArtistCard from '../components/WeverseArtistCard';

interface WeverseManagementProps {
  artists: WeverseArtist[];
  needWeverseLogin: boolean;
  isWeverseLoginLoading: boolean;
  isWeverseRefreshLoading: boolean;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onToggleArtist: (artistName: string, isEnabled: boolean) => Promise<void>;
}

const WeverseManagement: React.FC<WeverseManagementProps> = ({
  artists,
  needWeverseLogin,
  isWeverseLoginLoading,
  isWeverseRefreshLoading,
  onLogin,
  onLogout,
  onRefresh,
  onToggleArtist
}) => {
  console.log('🎵 WeverseManagement page rendering...');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      await onLogin();
    } catch (error) {
      console.error('Failed to login to Weverse:', error);
      alert('위버스 로그인에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('위버스에서 로그아웃 하시겠습니까?')) {
      return;
    }

    setIsLoading(true);
    try {
      await onLogout();
    } catch (error) {
      console.error('Failed to logout from Weverse:', error);
      alert('위버스 로그아웃에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      await onRefresh();
    } catch (error) {
      console.error('Failed to refresh Weverse artists:', error);
      alert('아티스트 목록 새로고침에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleArtist = async (artistName: string, isEnabled: boolean) => {
    setIsLoading(true);
    try {
      await onToggleArtist(artistName, isEnabled);
    } catch (error) {
      console.error('Failed to toggle Weverse artist:', error);
      alert('아티스트 설정 변경에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const enabledArtists = artists.filter(artist => artist.isEnabled);
  const disabledArtists = artists.filter(artist => !artist.isEnabled);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="space-y-8">
          {/* 헤더 */}
          <div className="text-center">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <h1 className="text-2xl font-bold text-white">
                    🎵 위버스 관리
                  </h1>
                  <p className="text-gray-400">
                    위버스 아티스트 알림을 관리하세요
                  </p>
                </div>
                
                <div className="flex space-x-2">
                  {needWeverseLogin ? (
                    <button
                      onClick={handleLogin}
                      className="btn btn-primary"
                      disabled={isLoading || isWeverseLoginLoading}
                    >
                      {isLoading || isWeverseLoginLoading ? (
                        <>
                          <span className="mr-2">⏳</span>
                          로그인 중...
                        </>
                      ) : (
                        <>
                          <span className="mr-2">🔐</span>
                          위버스 로그인
                        </>
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleRefresh}
                        className="btn btn-secondary"
                        disabled={isLoading || isWeverseRefreshLoading}
                      >
                        {isWeverseRefreshLoading ? (
                          <>
                            <span className="mr-2">⏳</span>
                            새로고침 중...
                          </>
                        ) : (
                          <>
                            <span className="mr-2">🔄</span>
                            새로고침
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleLogout}
                        className="btn btn-danger"
                        disabled={isLoading}
                      >
                        <span className="mr-2">🚪</span>
                        로그아웃
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 통계 카드 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card">
                  <div className="card-body">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-400">전체 아티스트</p>
                        <p className="text-3xl font-bold text-white mt-1">{artists.length}</p>
                      </div>
                      <div className="text-3xl">🎭</div>
                    </div>
                  </div>
                </div>
                
                <div className="card">
                  <div className="card-body">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-400">활성 아티스트</p>
                        <p className="text-3xl font-bold text-purple-400 mt-1">{enabledArtists.length}</p>
                      </div>
                      <div className="text-3xl">✨</div>
                    </div>
                  </div>
                </div>
                
                <div className="card">
                  <div className="card-body">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-400">로그인 상태</p>
                        <p className={`text-xl font-bold mt-1 ${needWeverseLogin ? 'text-red-400' : 'text-green-400'}`}>
                          {needWeverseLogin ? '미로그인' : '로그인됨'}
                        </p>
                      </div>
                      <div className="text-3xl">{needWeverseLogin ? '🔒' : '🔓'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 위버스 로그인 오버레이 */}
          {isWeverseLoginLoading && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
              <div className="glass-card p-8 text-center animate-glow">
                <div className="spinner spinner-lg mb-6"></div>
                <h2 className="text-xl font-bold text-white neon-text mb-2">위버스 로그인 중</h2>
                <p className="text-gray-400">브라우저에서 위버스 로그인을 완료해주세요...</p>
              </div>
            </div>
          )}

          {/* 아티스트 목록 */}
          <div className="space-y-6">
            {needWeverseLogin ? (
              <div className="text-center py-16">
                <div className="text-8xl mb-6">🔐</div>
                <h3 className="text-2xl font-semibold text-white mb-3">
                  위버스 로그인이 필요합니다
                </h3>
                <p className="text-lg text-gray-400 mb-8 max-w-md mx-auto">
                  위버스 아티스트 알림을 받으려면 먼저 로그인해주세요
                </p>
                <button
                  onClick={handleLogin}
                  className="btn btn-primary"
                  disabled={isLoading || isWeverseLoginLoading}
                >
                  <span className="mr-2">🎵</span>
                  위버스 로그인
                </button>
              </div>
            ) : artists.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-8xl mb-6">🎭</div>
                <h3 className="text-2xl font-semibold text-white mb-3">
                  아티스트가 없습니다
                </h3>
                <p className="text-lg text-gray-400 mb-8 max-w-md mx-auto">
                  위버스에서 팔로우하는 아티스트를 불러오세요
                </p>
                <button
                  onClick={handleRefresh}
                  className="btn btn-primary"
                  disabled={isLoading || isWeverseRefreshLoading}
                >
                  {isWeverseRefreshLoading ? (
                    <>
                      <span className="mr-2">⏳</span>
                      새로고침 중...
                    </>
                  ) : (
                    <>
                      <span className="mr-2">🔄</span>
                      아티스트 목록 새로고침
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {/* 활성 아티스트 */}
                {enabledArtists.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                      <h2 className="text-2xl font-semibold text-white">
                        활성 아티스트
                      </h2>
                      <span className="px-3 py-1 bg-purple-500/20 text-purple-300 text-sm font-medium rounded-full">
                        {enabledArtists.length}명
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {enabledArtists.map((artist) => (
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
                {disabledArtists.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                      <h2 className="text-2xl font-semibold text-white">
                        비활성 아티스트
                      </h2>
                      <span className="px-3 py-1 bg-gray-500/20 text-gray-300 text-sm font-medium rounded-full">
                        {disabledArtists.length}명
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {disabledArtists.map((artist) => (
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
        </div>
      </div>
    </div>
  );
};

export default WeverseManagement;
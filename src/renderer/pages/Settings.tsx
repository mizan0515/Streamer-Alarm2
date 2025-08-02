import React, { useState, useEffect } from 'react';
import DonationWidget from '../components/DonationWidget';

interface SettingsData {
  checkInterval: number;
  autoStart: boolean;
  minimizeToTray: boolean;
  showDesktopNotifications: boolean;
  cacheCleanupInterval: number;
  theme: string;
  needNaverLogin: boolean;
  needWeverseLogin: boolean;
  needTwitterLogin: boolean;
  twitterCredentials?: {
    username: string;
    password: string;
    isConfigured: boolean;
  };
}

interface SettingsProps {
  onNaverActionStart?: () => void;
  onNaverActionEnd?: () => void;
  onWeverseActionStart?: (action: 'login' | 'logout') => void;
  onWeverseActionEnd?: () => void;
  onTwitterActionStart?: (action: 'login' | 'logout' | 'configure') => void;
  onTwitterActionEnd?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onNaverActionStart, onNaverActionEnd, onWeverseActionStart, onWeverseActionEnd, onTwitterActionStart, onTwitterActionEnd }) => {
  console.log('⚙️ Settings page rendering...');
  const [settings, setSettings] = useState<SettingsData>({
    checkInterval: 30,
    autoStart: false,
    minimizeToTray: true,
    showDesktopNotifications: true,
    cacheCleanupInterval: 3600,
    theme: 'dark',
    needNaverLogin: true,
    needWeverseLogin: true,
    needTwitterLogin: true
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  useEffect(() => {
    loadSettings();
    
    // 네이버 로그인 상태 변경 이벤트 리스너 등록
    const handleNaverLoginStatusChange = (status: { needLogin: boolean }) => {
      console.log('🔄 Settings: Naver login status changed:', status);
      setSettings(prev => ({ ...prev, needNaverLogin: status.needLogin }));
    };
    
    // 트위터 로그인 상태 변경 이벤트 리스너 등록
    const handleTwitterLoginStatusChange = (status: { needLogin: boolean }) => {
      console.log('🔄 Settings: Twitter login status changed:', status);
      setSettings(prev => ({ ...prev, needTwitterLogin: status.needLogin }));
    };
    
    if (window.electronAPI?.onNaverLoginStatusChanged) {
      window.electronAPI.onNaverLoginStatusChanged(handleNaverLoginStatusChange);
    }
    
    if (window.electronAPI?.onTwitterLoginStatusChanged) {
      window.electronAPI.onTwitterLoginStatusChanged(handleTwitterLoginStatusChange);
    }
    
    // 컴포넌트 언마운트 시 리스너 해제
    return () => {
      if (window.electronAPI?.removeListener) {
        window.electronAPI.removeListener('naver-login-status-changed', handleNaverLoginStatusChange);
        window.electronAPI.removeListener('twitter-login-status-changed', handleTwitterLoginStatusChange);
      }
    };
  }, []);

  const loadSettings = async () => {
    try {
      if (window.electronAPI?.getSettings) {
        // 트위터 로그인 상태 수동 동기화 (설정 로드 전)
        if (window.electronAPI?.syncTwitterLoginStatus) {
          try {
            await window.electronAPI.syncTwitterLoginStatus();
            console.log('🔄 Twitter login status manually synced');
          } catch (syncError) {
            console.warn('⚠️ Failed to sync Twitter login status:', syncError);
          }
        }
        
        const settingsData = await window.electronAPI.getSettings();
        setSettings(settingsData);
      }
      setIsLoading(false);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setIsLoading(false);
    }
  };

  const handleSettingChange = async (key: keyof SettingsData, value: any) => {
    try {
      setIsSaving(true);
      if (window.electronAPI?.updateSetting) {
        const result = await window.electronAPI.updateSetting(key, value);
        if (!result) {
          throw new Error('Database not initialized');
        }
      }
      setSettings(prev => ({ ...prev, [key]: value }));
      setLastSaved(new Date());
      console.log(`✅ Setting ${key} updated successfully`);
    } catch (error) {
      console.error('Failed to update setting:', error);
      const errorMessage = (error as Error).message?.includes('Database') 
        ? '데이터베이스가 초기화되지 않았습니다. 앱을 재시작해주세요.'
        : '설정 저장에 실패했습니다.';
      alert(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      if (window.electronAPI?.testNotification) {
        const result = await window.electronAPI.testNotification();
        if (result) {
          alert('알림 테스트가 성공적으로 전송되었습니다!');
        } else {
          alert('알림 테스트 전송에 실패했습니다.');
        }
      } else {
        alert('알림 테스트 기능이 아직 구현되지 않았습니다.');
      }
    } catch (error) {
      console.error('Failed to test notification:', error);
      alert('알림 테스트 중 오류가 발생했습니다.');
    }
  };

  const handleRecoverNotifications = async () => {
    if (!confirm('누락된 알림을 복구하시겠습니까? 시간이 다소 걸릴 수 있습니다.')) {
      return;
    }

    try {
      const count = await window.electronAPI.recoverMissedNotifications();
      alert(`${count}개의 누락된 알림을 복구했습니다.`);
    } catch (error) {
      console.error('Failed to recover notifications:', error);
      alert('알림 복구 중 오류가 발생했습니다.');
    }
  };

  const handleNaverLogin = async () => {
    onNaverActionStart?.();
    try {
      const result = await window.electronAPI.naverLogin();
      if (result) {
        alert('네이버 로그인이 완료되었습니다.');
        // 설정 새로고침
        loadSettings();
      } else {
        alert('네이버 로그인에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to login to Naver:', error);
      alert('네이버 로그인 중 오류가 발생했습니다.');
    } finally {
      onNaverActionEnd?.();
    }
  };

  const handleNaverLogout = async () => {
    if (!confirm('네이버에서 로그아웃하시겠습니까? 카페 모니터링이 중단됩니다.')) {
      return;
    }

    onNaverActionStart?.();
    try {
      const result = await window.electronAPI.naverLogout();
      if (result) {
        alert('네이버 로그아웃이 완료되었습니다.');
        // 설정 새로고침
        loadSettings();
      } else {
        alert('네이버 로그아웃에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to logout from Naver:', error);
      alert('네이버 로그아웃 중 오류가 발생했습니다.');
    } finally {
      onNaverActionEnd?.();
    }
  };

  const handleWeverseLogin = async () => {
    onWeverseActionStart?.('login');
    try {
      const result = await window.electronAPI.weverseLogin();
      if (result) {
        alert('위버스 로그인이 완료되었습니다.');
        // 설정 새로고침
        loadSettings();
      } else {
        alert('위버스 로그인에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to login to Weverse:', error);
      alert('위버스 로그인 중 오류가 발생했습니다.');
    } finally {
      onWeverseActionEnd?.();
    }
  };

  const handleWeverseLogout = async () => {
    if (!confirm('위버스에서 로그아웃하시겠습니까? 위버스 모니터링이 중단됩니다.')) {
      return;
    }

    onWeverseActionStart?.('logout');
    try {
      const result = await window.electronAPI.weverseLogout();
      if (result) {
        alert('위버스 로그아웃이 완료되었습니다.');
        // 설정 새로고침
        loadSettings();
      } else {
        alert('위버스 로그아웃에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to logout from Weverse:', error);
      alert('위버스 로그아웃 중 오류가 발생했습니다.');
    } finally {
      onWeverseActionEnd?.();
    }
  };

  const handleTwitterLogin = async () => {
    onTwitterActionStart?.('login');
    try {
      const result = await window.electronAPI.twitterLogin();
      if (result) {
        alert('트위터 로그인이 완료되었습니다.');
        // 설정 새로고침
        loadSettings();
      } else {
        alert('트위터 로그인에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to login to Twitter:', error);
      alert('트위터 로그인 중 오류가 발생했습니다.');
    } finally {
      onTwitterActionEnd?.();
    }
  };

  const handleTwitterLogout = async () => {
    if (!confirm('트위터에서 로그아웃하시겠습니까? 트위터 모니터링이 중단됩니다.')) {
      return;
    }

    onTwitterActionStart?.('logout');
    try {
      const result = await window.electronAPI.twitterLogout();
      if (result) {
        alert('트위터 로그아웃이 완료되었습니다.');
        // 설정 새로고침
        loadSettings();
      } else {
        alert('트위터 로그아웃에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to logout from Twitter:', error);
      alert('트위터 로그아웃 중 오류가 발생했습니다.');
    } finally {
      onTwitterActionEnd?.();
    }
  };


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="spinner spinner-lg text-primary-500 mb-4"></div>
          <p className="text-gray-400">설정을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="space-y-8">
          {/* 헤더 */}
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white">설정</h1>
            <p className="text-gray-400 mt-1">
              애플리케이션 동작 방식을 설정하세요
            </p>
            {lastSaved && (
              <p className="text-xs text-green-400 mt-2">
                마지막 저장: {lastSaved.toLocaleTimeString()}
              </p>
            )}
          </div>

          <div className="space-y-8">
          {/* 일반 설정 */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-lg font-semibold text-white flex items-center">
                ⚙️ 일반 설정
              </h2>
            </div>
            <div className="card-body space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  체크 간격 (초)
                </label>
                <div className="flex items-center space-x-4">
                  <input
                    type="range"
                    min="10"
                    max="300"
                    step="10"
                    value={settings.checkInterval}
                    onChange={(e) => handleSettingChange('checkInterval', parseInt(e.target.value))}
                    className="flex-1"
                    disabled={isSaving}
                  />
                  <span className="text-white font-medium w-12 text-center">
                    {settings.checkInterval}초
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  스트리머 상태를 확인하는 주기를 설정합니다
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-300">Windows 시작 시 자동 실행</h3>
                  <p className="text-xs text-gray-400">시스템 부팅 시 자동으로 애플리케이션을 시작합니다</p>
                </div>
                <button
                  className={`switch ${settings.autoStart ? 'switch-enabled' : 'switch-disabled'}`}
                  onClick={() => handleSettingChange('autoStart', !settings.autoStart)}
                  disabled={isSaving}
                >
                  <span className={`switch-handle ${settings.autoStart ? 'switch-handle-enabled' : 'switch-handle-disabled'}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-300">창 닫기 시 트레이로 최소화</h3>
                  <p className="text-xs text-gray-400">X 버튼 클릭 시 시스템 트레이로 최소화됩니다</p>
                </div>
                <button
                  className={`switch ${settings.minimizeToTray ? 'switch-enabled' : 'switch-disabled'}`}
                  onClick={() => handleSettingChange('minimizeToTray', !settings.minimizeToTray)}
                  disabled={isSaving}
                >
                  <span className={`switch-handle ${settings.minimizeToTray ? 'switch-handle-enabled' : 'switch-handle-disabled'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* 알림 설정 */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-lg font-semibold text-white flex items-center">
                🔔 알림 설정
              </h2>
            </div>
            <div className="card-body space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-300">데스크톱 알림 표시</h3>
                  <p className="text-xs text-gray-400">Windows 토스트 알림을 표시합니다</p>
                </div>
                <button
                  className={`switch ${settings.showDesktopNotifications ? 'switch-enabled' : 'switch-disabled'}`}
                  onClick={() => handleSettingChange('showDesktopNotifications', !settings.showDesktopNotifications)}
                  disabled={isSaving}
                >
                  <span className={`switch-handle ${settings.showDesktopNotifications ? 'switch-handle-enabled' : 'switch-handle-disabled'}`} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={handleTestNotification}
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  🔔 알림 테스트
                </button>
                
                <button
                  onClick={handleRecoverNotifications}
                  className="btn btn-secondary"
                  disabled={isSaving}
                >
                  🔄 누락 알림 복구
                </button>
              </div>
            </div>
          </div>

          {/* 계정 관리 */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-lg font-semibold text-white flex items-center">
                🔐 계정 관리
              </h2>
            </div>
            <div className="card-body space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2">네이버 로그인 상태</h3>
                <div className="flex items-center justify-between">
                  <span className={`text-sm ${settings.needNaverLogin ? 'text-red-400' : 'text-green-400'}`}>
                    {settings.needNaverLogin ? '로그인 필요' : '로그인됨'}
                  </span>
                  {settings.needNaverLogin ? (
                    <button
                      onClick={handleNaverLogin}
                      className="btn btn-primary btn-sm"
                      disabled={isSaving}
                    >
                      🔐 네이버 로그인
                    </button>
                  ) : (
                    <button
                      onClick={handleNaverLogout}
                      className="btn btn-ghost btn-sm"
                      disabled={isSaving}
                    >
                      🚪 네이버 로그아웃
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  카페 모니터링을 위해 네이버 로그인이 필요합니다
                </p>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <h3 className="text-sm font-medium text-gray-300 mb-2">트위터 로그인 상태</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm ${settings.needTwitterLogin ? 'text-red-400' : 'text-green-400'}`}>
                      {settings.needTwitterLogin ? '⚠️ 로그인 필요' : '✅ 로그인됨'}
                    </span>
                    {!settings.needTwitterLogin && (
                      <div className="text-xs text-gray-500 mt-1">
                        봇 탐지 회피 시스템 - 세션 자동 관리
                      </div>
                    )}
                  </div>
                  {settings.needTwitterLogin ? (
                    <button
                      onClick={handleTwitterLogin}
                      className="btn btn-primary btn-sm"
                      disabled={isSaving}
                    >
                      🐦 트위터 로그인
                    </button>
                  ) : (
                    <button
                      onClick={handleTwitterLogout}
                      className="btn btn-ghost btn-sm"
                      disabled={isSaving}
                    >
                      🚪 트위터 로그아웃
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  트위터 모니터링을 위해 계정 로그인이 필요합니다.
                  브라우저 창이 열리면 직접 로그인해주세요. (네이버 카페, 위버스와 동일한 방식)
                </p>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <h3 className="text-sm font-medium text-gray-300 mb-2">위버스 로그인 상태</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm ${settings.needWeverseLogin ? 'text-red-400' : 'text-green-400'}`}>
                      {settings.needWeverseLogin ? '⚠️ 로그인 필요' : '✅ 로그인됨'}
                    </span>
                    {!settings.needWeverseLogin && (
                      <div className="text-xs text-gray-500 mt-1">
                        세션 영속성 지원 - 자동 로그인 유지
                      </div>
                    )}
                  </div>
                  {settings.needWeverseLogin ? (
                    <button
                      onClick={handleWeverseLogin}
                      className="btn btn-primary btn-sm"
                      disabled={isSaving}
                    >
                      🎵 위버스 로그인
                    </button>
                  ) : (
                    <button
                      onClick={handleWeverseLogout}
                      className="btn btn-ghost btn-sm"
                      disabled={isSaving}
                    >
                      🚪 위버스 로그아웃
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  위버스 아티스트 알림 모니터링을 위해 위버스 로그인이 필요합니다.
                  로그인 후 세션이 자동으로 저장되어 앱 재시작 시에도 유지됩니다.
                </p>
              </div>

              <div className="border-t border-gray-700 pt-4">
                <h3 className="text-sm font-medium text-gray-300 mb-2">시스템 정보</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-400">플랫폼:</span>
                    <span className="text-white ml-2">{window.electronAPI?.getPlatform?.() || 'Windows'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">버전:</span>
                    <span className="text-white ml-2">{window.electronAPI?.getAppVersion?.() || '1.0.0'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 고급 설정 */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-lg font-semibold text-white flex items-center">
                🔧 고급 설정
              </h2>
            </div>
            <div className="card-body space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  캐시 정리 간격 (초)
                </label>
                <div className="flex items-center space-x-4">
                  <input
                    type="number"
                    min="600"
                    max="86400"
                    step="600"
                    value={settings.cacheCleanupInterval}
                    onChange={(e) => handleSettingChange('cacheCleanupInterval', parseInt(e.target.value))}
                    className="input w-24"
                    disabled={isSaving}
                  />
                  <span className="text-gray-400 text-sm">
                    ({Math.round(settings.cacheCleanupInterval / 60)}분)
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  브라우저 캐시를 자동으로 정리하는 주기를 설정합니다
                </p>
              </div>
            </div>
          </div>

          {/* 개발자 후원 */}
          <div className="card">
            <div className="card-header">
              <h2 className="text-lg font-semibold text-white flex items-center">
                💝 개발자 후원
              </h2>
            </div>
            <div className="card-body">
              <DonationWidget />
            </div>
          </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Settings;
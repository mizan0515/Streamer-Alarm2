import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MonitoringStats } from '@shared/types';

interface SidebarProps {
  stats: MonitoringStats;
  onNaverActionStart?: () => void;
  onNaverActionEnd?: () => void;
}

interface Settings {
  needNaverLogin?: boolean;
  needWeverseLogin?: boolean;
  [key: string]: any;
}

const Sidebar: React.FC<SidebarProps> = ({ stats, onNaverActionStart, onNaverActionEnd }) => {
  const location = useLocation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // 설정 변경 이벤트 리스너
  useEffect(() => {
    // 초기 설정 로드
    const loadSettings = async () => {
      try {
        const initialSettings = await window.electronAPI?.getSettings?.();
        if (initialSettings) {
          setSettings(initialSettings);
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoadingSettings(false);
      }
    };

    loadSettings();

    // 통합된 설정 업데이트 리스너
    const handleSettingsUpdate = (newSettings: Settings) => {
      console.log('🔄 Sidebar: Settings updated', newSettings);
      setSettings(newSettings);
      setIsLoadingSettings(false);
    };

    // 이벤트 리스너 등록
    if (window.electronAPI?.on) {
      window.electronAPI.on('settings-updated', handleSettingsUpdate);
    }

    // 컴포넌트 언마운트 시 리스너 해제
    return () => {
      if (window.electronAPI?.removeListener) {
        window.electronAPI.removeListener('settings-updated', handleSettingsUpdate);
      }
    };
  }, []);

  const handleNaverAction = async () => {
    if (settings?.needNaverLogin === true) {
      console.log('🔐 Naver login button clicked');
      onNaverActionStart?.();
      try {
        const result = await window.electronAPI?.naverLogin?.();
        if (result) {
          console.log('✅ Sidebar: Naver login successful');
          alert('네이버 로그인이 완료되었습니다.');
          // 로그인 성공 후 설정 새로고침
          const updatedSettings = await window.electronAPI?.getSettings?.();
          if (updatedSettings) {
            setSettings(updatedSettings);
            console.log('🔄 Sidebar: Settings refreshed after login', updatedSettings);
          }
        } else {
          console.log('❌ Sidebar: Naver login failed');
          alert('네이버 로그인에 실패했습니다.');
        }
      } catch (error) {
        console.error('❌ Sidebar: Naver login error:', error);
        alert('네이버 로그인 중 오류가 발생했습니다.');
      } finally {
        onNaverActionEnd?.();
      }
    } else {
      console.log('🚪 Naver logout button clicked');
      onNaverActionStart?.();
      try {
        const result = await window.electronAPI?.naverLogout?.();
        if (result) {
          console.log('✅ Sidebar: Naver logout successful');
          alert('네이버 로그아웃이 완료되었습니다.');
          // 로그아웃 성공 후 설정 새로고침
          const updatedSettings = await window.electronAPI?.getSettings?.();
          if (updatedSettings) {
            setSettings(updatedSettings);
            console.log('🔄 Sidebar: Settings refreshed after logout', updatedSettings);
          }
        } else {
          console.log('❌ Sidebar: Naver logout failed');
          alert('네이버 로그아웃에 실패했습니다.');
        }
      } catch (error) {
        console.error('❌ Sidebar: Naver logout error:', error);
        alert('네이버 로그아웃 중 오류가 발생했습니다.');
      } finally {
        onNaverActionEnd?.();
      }
    }
  };

  const navItems = [
    {
      path: '/',
      icon: '👥',
      label: '스트리머 관리',
      description: '모니터링할 스트리머 추가/편집',
      primary: true
    },
    {
      path: '/weverse',
      icon: '🎵',
      label: '위버스 관리',
      description: '위버스 아티스트 알림 설정',
      primary: false
    },
    {
      path: '/notifications',
      icon: '📋',
      label: '알림 기록',
      description: '받은 알림 히스토리',
      primary: false
    },
    {
      path: '/settings',
      icon: '⚙️',
      label: '설정',
      description: '앱 설정 및 계정 관리',
      primary: false
    }
  ];

  const getStatusColor = (isMonitoring: boolean) => {
    return isMonitoring ? 'text-green-400' : 'text-red-400';
  };

  const getStatusText = (isMonitoring: boolean) => {
    return isMonitoring ? '모니터링 중' : '중지됨';
  };

  return (
    <aside className="w-80 glass-card flex flex-col shadow-2xl border-r border-white/10 scrollbar-neon">
      {/* 로고 및 타이틀 */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center space-x-4">
          <div className="text-4xl animate-float">📺</div>
          <div>
            <h1 className="text-2xl font-bold text-white neon-text-subtle">
              Streamer Alarm
            </h1>
            <p className="text-sm text-gray-300 mt-1">
              스트리머 알림 시스템
            </p>
          </div>
        </div>
      </div>

      {/* 시스템 상태 */}
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">상태</span>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            stats.isMonitoring 
              ? 'bg-green-500/20 text-green-300 border border-green-500/30' 
              : 'bg-red-500/20 text-red-300 border border-red-500/30'
          }`}>
            {getStatusText(stats.isMonitoring)}
          </span>
        </div>
        
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="glass rounded-lg p-2">
            <div className="text-lg font-bold text-orange-400 relative">
              {stats.unreadNotifications}
              {stats.unreadNotifications > 0 && (
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              )}
            </div>
            <div className="text-xs text-gray-400">안읽음</div>
          </div>
          <div className="glass rounded-lg p-2">
            <div className="text-lg font-bold text-green-400">{stats.activeStreamers}</div>
            <div className="text-xs text-gray-400">활성</div>
          </div>
          <div className="glass rounded-lg p-2">
            <div className="text-lg font-bold text-red-400">{stats.liveStreamers}</div>
            <div className="text-xs text-gray-400">라이브</div>
          </div>
          <div className="glass rounded-lg p-2">
            <div className="text-lg font-bold text-blue-400">{stats.totalNotifications}</div>
            <div className="text-xs text-gray-400">총알림</div>
          </div>
        </div>
      </div>

      {/* 네비게이션 메뉴 */}
      <nav className="flex-1 p-6">
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">메뉴</h3>
        </div>
        <ul className="space-y-2">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) => {
                  console.log(`🔗 NavLink clicked: ${item.path}, isActive: ${isActive}`);
                  return `flex items-center space-x-3 p-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-purple-600/20 text-white border border-purple-500/30 shadow-lg'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`;
                }}
              >
                <span className="text-xl flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{item.label}</div>
                  <div className="text-xs opacity-75 truncate">{item.description}</div>
                </div>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* 로그인 상태 */}
      <div className="p-4 border-t border-white/10">
        <div className="mb-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">로그인 상태</h3>
        </div>
        {isLoadingSettings ? (
          <div className="text-xs text-gray-400 text-center">
            <span className="spinner spinner-sm mr-1"></span>
            설정 로드 중...
          </div>
        ) : (
          <div className="space-y-2">
            {/* 네이버 로그인 상태 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">네이버</span>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                !settings?.needNaverLogin 
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30' 
                  : 'bg-red-500/20 text-red-300 border border-red-500/30'
              }`}>
                {!settings?.needNaverLogin ? '로그인됨' : '미로그인'}
              </span>
            </div>
            
            {/* 위버스 로그인 상태 */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">위버스</span>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                !settings?.needWeverseLogin 
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30' 
                  : 'bg-red-500/20 text-red-300 border border-red-500/30'
              }`}>
                {!settings?.needWeverseLogin ? '로그인됨' : '미로그인'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 앱 정보 */}
      <div className="p-4 border-t border-white/10">
        <div className="text-center text-xs text-gray-500 space-y-1">
          <div>v{window.electronAPI?.getAppVersion?.() || '1.0.0'}</div>
          {window.electronAPI?.isDev?.() && (
            <div className="text-yellow-400 text-xs">🚧 DEV</div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
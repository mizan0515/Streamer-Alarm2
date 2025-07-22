import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import StreamerManagement from './pages/StreamerManagement';
import NotificationHistory from './pages/NotificationHistory';
import Settings from './pages/Settings';
import WeverseManagement from './pages/WeverseManagement';
import { StreamerData, NotificationRecord, MonitoringStats, WeverseArtist, LiveStatus } from '@shared/types';

const App: React.FC = () => {
  console.log('🚀 App component rendering...');
  
  const [streamers, setStreamers] = useState<StreamerData[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [weverseArtists, setWeverseArtists] = useState<WeverseArtist[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<LiveStatus[]>([]);
  const [needWeverseLogin, setNeedWeverseLogin] = useState(true);
  const [stats, setStats] = useState<MonitoringStats>({
    totalStreamers: 0,
    activeStreamers: 0,
    liveStreamers: 0,
    totalNotifications: 0,
    unreadNotifications: 0,
    isMonitoring: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isNaverActionLoading, setIsNaverActionLoading] = useState(false);
  const [isWeverseLoginLoading, setIsWeverseLoginLoading] = useState(false);
  const [isWeverseRefreshLoading, setIsWeverseRefreshLoading] = useState(false);
  const [weverseAction, setWeverseAction] = useState<'login' | 'logout' | null>(null);

  // 오버레이 상태 디버깅
  useEffect(() => {
    console.log('🔍 Overlay state changed - isWeverseLoginLoading:', isWeverseLoginLoading, 'isNaverActionLoading:', isNaverActionLoading);
  }, [isWeverseLoginLoading, isNaverActionLoading]);

  useEffect(() => {
    initializeApp();
    setupEventListeners();
    
    return () => {
      cleanupEventListeners();
    };
  }, []);

  const initializeApp = async () => {
    try {
      console.log('🔄 Initializing app with real data...');
      setIsLoading(true);
      
      // 스트리머 데이터 로드
      let streamersData: StreamerData[] = [];
      if (window.electronAPI?.getStreamers) {
        streamersData = await window.electronAPI.getStreamers();
        console.log('📊 Loaded streamers:', streamersData.length);
        setStreamers(streamersData);
      }
      
      // 알림 데이터 로드
      let notificationsData: NotificationRecord[] = [];
      if (window.electronAPI?.getNotifications) {
        notificationsData = await window.electronAPI.getNotifications({ limit: 100 });
        console.log('🔔 Loaded notifications:', notificationsData.length);
        setNotifications(notificationsData);
      }
      
      // 위버스 아티스트 데이터 로드
      let weverseArtistsData: WeverseArtist[] = [];
      if (window.electronAPI?.getWeverseArtists) {
        try {
          weverseArtistsData = await window.electronAPI.getWeverseArtists();
          console.log('🎵 Loaded Weverse artists:', weverseArtistsData.length);
          setWeverseArtists(weverseArtistsData);
        } catch (error) {
          console.warn('Failed to load Weverse artists:', error);
        }
      }
      
      // 위버스 로그인 상태 확인
      if (window.electronAPI?.getSettings) {
        try {
          const settings = await window.electronAPI.getSettings();
          setNeedWeverseLogin(settings.needWeverseLogin);
        } catch (error) {
          console.warn('Failed to get Weverse login status:', error);
        }
      }
      
      // 통계 업데이트 (로드된 데이터 사용)
      updateStats(streamersData, notificationsData);
      
      setIsLoading(false);
      console.log('✅ App initialization completed');
    } catch (error) {
      console.error('❌ Failed to initialize app:', error);
      setIsLoading(false);
    }
  };

  const setupEventListeners = () => {
    console.log('🔗 Setting up event listeners...');
    
    // 알림 업데이트 이벤트 리스너
    if (window.electronAPI?.on) {
      window.electronAPI.on('notification-history-updated', (updatedNotifications: NotificationRecord[]) => {
        console.log('🔔 Received notification update:', updatedNotifications.length);
        setNotifications(updatedNotifications);
        // streamers 상태를 직접 참조하는 대신 현재 값을 사용
        setStats(prevStats => ({
          ...prevStats,
          totalNotifications: updatedNotifications.length,
          unreadNotifications: updatedNotifications.filter(n => !n.isRead).length
        }));
      });

      // 설정 업데이트 이벤트 리스너 (네이버 로그인 상태 변경 등)
      window.electronAPI.on('settings-updated', (updatedSettings: Record<string, any>) => {
        console.log('⚙️ Received settings update:', updatedSettings);
        // 위버스 로그인 상태 업데이트
        if (updatedSettings.needWeverseLogin !== undefined) {
          setNeedWeverseLogin(updatedSettings.needWeverseLogin);
        }
      });
      
      // 위버스 아티스트 업데이트 이벤트 리스너
      window.electronAPI.on('weverse-artists-updated', (updatedArtists: WeverseArtist[]) => {
        console.log('🎵 Received Weverse artists update:', updatedArtists.length);
        setWeverseArtists(updatedArtists);
      });

      // 위버스 아티스트 라이브 상태 업데이트 이벤트 리스너 (제거됨)

      // 스트리머 라이브 상태 업데이트 이벤트 리스너
      window.electronAPI.on('live-status-updated', (liveStatuses: LiveStatus[]) => {
        console.log('🔴 Received live status update:', liveStatuses.length);
        setLiveStatuses(liveStatuses);
        
        // 실시간으로 라이브 스트리머 수 업데이트
        const liveCount = liveStatuses.filter(status => status.isLive).length;
        setStats(prevStats => ({
          ...prevStats,
          liveStreamers: liveCount
        }));
      });

      // 위버스 로그인 상태 변경 이벤트 리스너
      window.electronAPI.on('weverse-login-status-changed', (data: { needLogin: boolean }) => {
        console.log('🔐 Received Weverse login status change:', data);
        setNeedWeverseLogin(data.needLogin);
        
        // 로그인 완료 시 오버레이 해제
        if (!data.needLogin) {
          console.log('🔐 Login completed - hiding overlay');
          setIsWeverseLoginLoading(false);
          setWeverseAction(null);
          
          // 아티스트 목록도 새로고침
          window.electronAPI.getWeverseArtists().then(artists => {
            setWeverseArtists(artists);
          }).catch(error => {
            console.error('Failed to refresh artists after login:', error);
          });
        } else {
          // 로그아웃 시 아티스트 목록 초기화
          console.log('🚪 Logout completed - hiding overlay');
          setIsWeverseLoginLoading(false);
          setWeverseAction(null);
          setWeverseArtists([]);
        }
      });

      // 스트리머 데이터 업데이트 이벤트 리스너
      window.electronAPI.on('streamer-data-updated', (updatedStreamers: StreamerData[]) => {
        console.log('👥 Received streamer update:', updatedStreamers.length);
        setStreamers(updatedStreamers);
        updateStats(updatedStreamers, notifications);
      });

      // 모니터링 상태 변경 이벤트 리스너
      window.electronAPI.on('monitoring-status-changed', (isMonitoring: boolean) => {
        console.log('📊 Monitoring status changed:', isMonitoring);
        setStats(prev => ({ ...prev, isMonitoring }));
      });
    }
  };

  const cleanupEventListeners = () => {
    console.log('🧹 Cleaning up event listeners...');
    
    if (window.electronAPI?.removeAllListeners) {
      window.electronAPI.removeAllListeners('notification-history-updated');
      window.electronAPI.removeAllListeners('streamer-data-updated');
      window.electronAPI.removeAllListeners('monitoring-status-changed');
      window.electronAPI.removeAllListeners('settings-updated');
      window.electronAPI.removeAllListeners('weverse-artists-updated');
      window.electronAPI.removeAllListeners('weverse-login-status-changed');
      window.electronAPI.removeAllListeners('live-status-updated');
    }
  };

  const getTotalNotificationCount = async (): Promise<number> => {
    try {
      if (window.electronAPI?.getTotalNotificationCount) {
        return await window.electronAPI.getTotalNotificationCount({});
      }
    } catch (error) {
      console.error('Failed to get total notification count:', error);
    }
    return 0;
  };

  const updateStats = async (streamersData: StreamerData[], notificationsData: NotificationRecord[]) => {
    // 읽지않은 알림 수 가져오기
    let unreadCount = 0;
    try {
      if (window.electronAPI?.getUnreadCount) {
        unreadCount = await window.electronAPI.getUnreadCount();
      }
    } catch (error) {
      console.error('Failed to get unread count:', error);
      // 폴백: 클라이언트에서 계산
      unreadCount = notificationsData.filter(n => !n.isRead).length;
    }

    // 실제 모니터링 상태 확인
    let isMonitoring = false;
    try {
      // MonitoringService의 상태를 확인하는 API 호출 (추가 필요)
      if (window.electronAPI?.getMonitoringStatus) {
        isMonitoring = await window.electronAPI.getMonitoringStatus();
      }
    } catch (error) {
      console.error('Failed to get monitoring status:', error);
    }

    // 라이브 상태 확인
    let liveStreamers = 0;
    try {
      if (window.electronAPI?.getLiveStatus) {
        const liveStatus = await window.electronAPI.getLiveStatus();
        setLiveStatuses(liveStatus);
        liveStreamers = liveStatus.filter((status: LiveStatus) => status.isLive).length;
      }
    } catch (error) {
      console.error('Failed to get live status:', error);
    }

    setStats({
      totalStreamers: streamersData.length,
      activeStreamers: streamersData.filter(s => s.isActive).length,
      liveStreamers: liveStreamers,
      totalNotifications: await getTotalNotificationCount(),
      unreadNotifications: unreadCount,
      isMonitoring: isMonitoring
    });
  };

  const handleAddStreamer = async (streamerData: Omit<StreamerData, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      console.log('➕ Adding streamer:', streamerData.name);
      
      if (window.electronAPI?.addStreamer) {
        const newStreamer = await window.electronAPI.addStreamer(streamerData);
        console.log('✅ Streamer added successfully:', newStreamer);
        
        // 스트리머 목록 새로고침
        const updatedStreamers = await window.electronAPI.getStreamers();
        setStreamers(updatedStreamers);
        updateStats(updatedStreamers, notifications);
      }
    } catch (error) {
      console.error('❌ Failed to add streamer:', error);
      alert('스트리머 추가에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleUpdateStreamer = async (streamerData: StreamerData) => {
    try {
      console.log('✏️ Updating streamer:', streamerData.name);
      
      if (window.electronAPI?.updateStreamer) {
        const updatedStreamer = await window.electronAPI.updateStreamer(streamerData);
        console.log('✅ Streamer updated successfully:', updatedStreamer);
        
        // 스트리머 목록 새로고침
        const updatedStreamers = await window.electronAPI.getStreamers();
        setStreamers(updatedStreamers);
        updateStats(updatedStreamers, notifications);
      }
    } catch (error) {
      console.error('❌ Failed to update streamer:', error);
      alert('스트리머 수정에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeleteStreamer = async (streamerId: number) => {
    try {
      const streamer = streamers.find(s => s.id === streamerId);
      const streamerName = streamer?.name || `ID ${streamerId}`;
      
      if (!confirm(`정말로 "${streamerName}" 스트리머를 삭제하시겠습니까?`)) {
        return;
      }
      
      console.log('🗑️ Deleting streamer:', streamerName);
      
      if (window.electronAPI?.deleteStreamer) {
        const success = await window.electronAPI.deleteStreamer(streamerId);
        
        if (success) {
          console.log('✅ Streamer deleted successfully');
          
          // 스트리머 목록 새로고침
          const updatedStreamers = await window.electronAPI.getStreamers();
          setStreamers(updatedStreamers);
          updateStats(updatedStreamers, notifications);
        } else {
          throw new Error('삭제 작업이 실패했습니다');
        }
      }
    } catch (error) {
      console.error('❌ Failed to delete streamer:', error);
      alert('스트리머 삭제에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleRefreshNotifications = async () => {
    try {
      console.log('🔄 Refreshing notifications...');
      
      if (window.electronAPI?.getNotifications) {
        const notificationsData = await window.electronAPI.getNotifications({ limit: 100 });
        console.log('✅ Notifications refreshed:', notificationsData.length);
        setNotifications(notificationsData);
        updateStats(streamers, notificationsData);
      }
    } catch (error) {
      console.error('❌ Failed to refresh notifications:', error);
      alert('알림 새로고침에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
    }
  };
  
  // 위버스 관련 핸들러
  const handleWeverseLogin = async () => {
    try {
      console.log('🔐 Initiating Weverse login...');
      console.log('🔐 Setting isWeverseLoginLoading to true...');
      setIsWeverseLoginLoading(true);
      setWeverseAction('login');
      console.log('🔐 isWeverseLoginLoading set to true, action: login');
      
      if (window.electronAPI?.weverseLogin) {
        await window.electronAPI.weverseLogin();
        console.log('✅ Weverse login completed');
        
        // 설정 새로고침
        const settings = await window.electronAPI.getSettings();
        setNeedWeverseLogin(settings.needWeverseLogin);
        
        // 아티스트 목록 새로고침은 이벤트 리스너에서 처리
        console.log('✅ Weverse login API call completed');
      }
    } catch (error) {
      console.error('❌ Failed to login to Weverse:', error);
      alert('위버스 로그인에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
      // 오류 시에만 오버레이 해제
      console.log('🔐 Login failed - hiding overlay');
      setIsWeverseLoginLoading(false);
      setWeverseAction(null);
    }
  };
  
  const handleWeverseLogout = async () => {
    try {
      console.log('🚪 Initiating Weverse logout...');
      console.log('🚪 Setting isWeverseLoginLoading to true...');
      setIsWeverseLoginLoading(true);
      setWeverseAction('logout');
      console.log('🚪 isWeverseLoginLoading set to true, action: logout');
      
      if (window.electronAPI?.weverseLogout) {
        await window.electronAPI.weverseLogout();
        console.log('✅ Weverse logout completed');
        
        // 설정 새로고침
        const settings = await window.electronAPI.getSettings();
        setNeedWeverseLogin(settings.needWeverseLogin);
        
        // 아티스트 목록 초기화는 이벤트 리스너에서 처리
        console.log('✅ Weverse logout API call completed');
      }
    } catch (error) {
      console.error('❌ Failed to logout from Weverse:', error);
      alert('위버스 로그아웃에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
      // 오류 시에만 오버레이 해제
      console.log('🚪 Logout failed - hiding overlay');
      setIsWeverseLoginLoading(false);
      setWeverseAction(null);
    }
  };
  
  const handleRefreshWeverseArtists = async () => {
    try {
      console.log('🔄 Refreshing Weverse artists...');
      setIsWeverseRefreshLoading(true);
      
      if (window.electronAPI?.refreshWeverseArtists) {
        await window.electronAPI.refreshWeverseArtists();
        console.log('✅ Weverse artists refreshed');
        
        // 아티스트 목록 새로고침
        const artists = await window.electronAPI.getWeverseArtists();
        setWeverseArtists(artists);
      }
    } catch (error) {
      console.error('❌ Failed to refresh Weverse artists:', error);
      alert('위버스 아티스트 새로고침에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsWeverseRefreshLoading(false);
    }
  };
  
  const handleToggleWeverseArtist = async (artistName: string, isEnabled: boolean) => {
    try {
      console.log(`🎵 Toggling Weverse artist ${artistName} to ${isEnabled}`);
      
      if (window.electronAPI?.updateWeverseArtist) {
        await window.electronAPI.updateWeverseArtist({ artistName, isEnabled });
        console.log('✅ Weverse artist status updated');
        
        // 아티스트 목록 새로고침
        const artists = await window.electronAPI.getWeverseArtists();
        setWeverseArtists(artists);
      }
    } catch (error) {
      console.error('❌ Failed to toggle Weverse artist:', error);
      alert('위버스 아티스트 설정 변경에 실패했습니다: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center glass-card p-8 animate-glow">
          <div className="spinner spinner-lg mb-6"></div>
          <h2 className="text-xl font-bold text-white neon-text mb-2">시스템 초기화 중</h2>
          <p className="text-gray-400">잠시만 기다려주세요...</p>
        </div>
      </div>
    );
  }

  console.log('📍 Current hash:', window.location.hash);
  console.log('📍 Current pathname:', window.location.pathname);
  console.log('📊 Stats:', stats);
  console.log('👥 Streamers:', streamers.length);
  console.log('🔔 Notifications:', notifications.length);

  return (
    <div className="flex h-screen text-white overflow-hidden relative">
      {/* 네이버 로그인/로그아웃 로딩 오버레이 */}
      {isNaverActionLoading && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="glass-card p-8 text-center animate-glow">
            <div className="spinner spinner-lg mb-6"></div>
            <h2 className="text-xl font-bold text-white neon-text mb-2">네이버 계정 처리 중</h2>
            <p className="text-gray-400">잠시만 기다려주세요...</p>
          </div>
        </div>
      )}
      
      {/* 위버스 로그인/로그아웃 로딩 오버레이 */}
      {isWeverseLoginLoading && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="glass-card p-8 text-center animate-glow">
            <div className="spinner spinner-lg mb-6"></div>
            <h2 className="text-xl font-bold text-white neon-text mb-2">
              {weverseAction === 'login' ? '위버스 로그인 중' : '위버스 로그아웃 중'}
            </h2>
            <p className="text-gray-400">잠시만 기다려주세요...</p>
          </div>
        </div>
      )}
      
      {/* 위버스 아티스트 새로고침 로딩 오버레이 */}
      {isWeverseRefreshLoading && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="glass-card p-8 text-center animate-glow">
            <div className="spinner spinner-lg mb-6"></div>
            <h2 className="text-xl font-bold text-white neon-text mb-2">아티스트 목록 새로고침 중</h2>
            <p className="text-gray-400">위버스에서 아티스트 정보를 가져오는 중입니다...</p>
          </div>
        </div>
      )}
      
      <Sidebar 
        stats={stats} 
        needWeverseLogin={needWeverseLogin}
        onNaverActionStart={() => setIsNaverActionLoading(true)}
        onNaverActionEnd={() => setIsNaverActionLoading(false)}
      />
      <main className="flex-1 overflow-hidden scrollbar-neon">
        <Routes>
          <Route 
            path="/" 
            element={
              <div className="h-full">
                <StreamerManagement 
                  streamers={streamers}
                  liveStatuses={liveStatuses}
                  liveStreamersCount={stats.liveStreamers}
                  onAdd={handleAddStreamer}
                  onUpdate={handleUpdateStreamer}
                  onDelete={handleDeleteStreamer}
                />
              </div>
            } 
          />
          <Route 
            path="/notifications" 
            element={
              <div className="h-full">
                <NotificationHistory 
                  notifications={notifications}
                  onNotificationsUpdate={(newNotifications) => {
                    setNotifications(newNotifications);
                    updateStats(streamers, newNotifications);
                  }}
                />
              </div>
            } 
          />
          <Route 
            path="/weverse" 
            element={
              <div className="h-full">
                <WeverseManagement 
                  artists={weverseArtists}
                  needWeverseLogin={needWeverseLogin}
                  isWeverseLoginLoading={isWeverseLoginLoading}
                  isWeverseRefreshLoading={isWeverseRefreshLoading}
                  onLogin={handleWeverseLogin}
                  onLogout={handleWeverseLogout}
                  onRefresh={handleRefreshWeverseArtists}
                  onToggleArtist={handleToggleWeverseArtist}
                />
              </div>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <div className="h-full">
                <Settings 
                  onNaverActionStart={() => setIsNaverActionLoading(true)}
                  onNaverActionEnd={() => setIsNaverActionLoading(false)}
                  onWeverseActionStart={(action) => {
                    setIsWeverseLoginLoading(true);
                    setWeverseAction(action);
                  }}
                  onWeverseActionEnd={() => {
                    setIsWeverseLoginLoading(false);
                    setWeverseAction(null);
                  }}
                />
              </div>
            } 
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
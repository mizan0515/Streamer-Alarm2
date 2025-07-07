import React, { useState, useEffect } from 'react';
import { NotificationRecord } from '@shared/types';

interface NotificationHistoryProps {
  notifications: NotificationRecord[];
  onNotificationsUpdate: (notifications: NotificationRecord[]) => void;
}

const NotificationHistory: React.FC<NotificationHistoryProps> = ({
  notifications,
  onNotificationsUpdate
}) => {
  console.log('🔔 NotificationHistory page rendering...', {
    notificationCount: notifications.length,
    sampleNotification: notifications[0] ? {
      id: notifications[0].id,
      profileImageUrl: notifications[0].profileImageUrl,
      isRead: notifications[0].isRead,
      createdAt: notifications[0].createdAt
    } : null
  });
  const [filter, setFilter] = useState<'all' | 'live' | 'cafe' | 'twitter'>('all');
  const [isLoading, setIsLoading] = useState(false);

  // 페이지 진입 시 모든 알림 읽음 처리
  useEffect(() => {
    const markAllAsRead = async () => {
      try {
        await window.electronAPI.markAllNotificationsRead();
        // 실시간 업데이트를 통해 자동으로 UI가 업데이트됨
      } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
      }
    };

    // 페이지 진입 시 자동으로 모든 알림 읽음 처리
    markAllAsRead();
  }, []); // 빈 의존성 배열로 컴포넌트 마운트 시 한 번만 실행

  // 실시간 알림 업데이트 리스너
  useEffect(() => {
    const handleNotificationUpdate = (newNotifications: NotificationRecord[]) => {
      console.log('📩 Received notification history update:', newNotifications.length);
      onNotificationsUpdate(newNotifications);
    };

    // IPC 리스너 등록
    if (window.electronAPI?.on) {
      window.electronAPI.on('notification-history-updated', handleNotificationUpdate);
    }

    return () => {
      // 클리너프 시 리스너 제거
      if (window.electronAPI?.removeAllListeners) {
        window.electronAPI.removeAllListeners('notification-history-updated');
      }
    };
  }, [onNotificationsUpdate]);

  const filteredNotifications = notifications.filter(notification => {
    if (filter === 'all') return true;
    return notification.type === filter;
  });


  const handleClearAll = async () => {
    if (!confirm('모든 알림 기록을 삭제하시겠습니까?')) {
      return;
    }

    try {
      await window.electronAPI.deleteAllNotifications();
      // 실시간 업데이트를 통해 자동으로 UI가 업데이트됨
    } catch (error) {
      console.error('Failed to clear notifications:', error);
      alert('알림 기록 삭제에 실패했습니다.');
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'live': return '📺';
      case 'cafe': return '💬';
      case 'twitter': return '🐦';
      default: return '📢';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'live': return 'text-red-400';
      case 'cafe': return 'text-green-400';
      case 'twitter': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  };

  const formatDate = (dateString: string) => {
    try {
      if (!dateString) return '날짜 없음';
      
      const date = new Date(dateString);
      
      // Invalid Date 체크
      if (isNaN(date.getTime())) {
        console.warn('Invalid date string:', dateString);
        return '잘못된 날짜';
      }
      
      return date.toLocaleDateString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('Date formatting error:', error, 'for date:', dateString);
      return '날짜 오류';
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="space-y-8">
          {/* 헤더 */}
          <div className="text-center">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white">알림 기록</h1>
                <p className="text-gray-400 mt-1">
                  받은 알림의 히스토리를 확인하세요
                </p>
              </div>
              
              <div className="flex space-x-2">
                <button
                  onClick={handleClearAll}
                  className="btn btn-danger"
                  disabled={notifications.length === 0}
                >
                  🗑️ 모두 삭제
                </button>
              </div>
            </div>

            {/* 필터 */}
            <div className="flex space-x-2 mt-4">
              {[
                { key: 'all', label: '🔍 전체', count: notifications.length },
                { key: 'live', label: '📺 방송', count: notifications.filter(n => n.type === 'live').length },
                { key: 'cafe', label: '💬 카페', count: notifications.filter(n => n.type === 'cafe').length },
                { key: 'twitter', label: '🐦 트위터', count: notifications.filter(n => n.type === 'twitter').length }
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setFilter(item.key as any)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filter === item.key
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {item.label} ({item.count})
                </button>
              ))}
            </div>
          </div>

          {/* 알림 목록 */}
          <div className="space-y-6">
            {filteredNotifications.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🔔</div>
                <h3 className="text-lg font-medium text-white mb-2">
                  {filter === 'all' ? '알림 기록이 없습니다' : `${filter} 알림이 없습니다`}
                </h3>
                <p className="text-gray-400">
                  스트리머들의 활동이 감지되면 여기에 표시됩니다
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredNotifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="card hover-lift cursor-pointer"
                    onClick={async () => {
                      // 읽지않은 알림인 경우 읽음 처리
                      if (!notification.isRead) {
                        try {
                          console.log('🔄 Marking notification as read:', notification.id, notification.title);
                          
                          // 1. 즉시 로컬 상태 업데이트 (낙관적 업데이트)
                          const updatedNotifications = notifications.map(n => 
                            n.id === notification.id ? { ...n, isRead: true } : n
                          );
                          onNotificationsUpdate(updatedNotifications);
                          
                          // 2. 데이터베이스 업데이트
                          await window.electronAPI.markNotificationRead(notification.id);
                          
                          // 실시간 업데이트를 통해 자동으로 동기화됨
                          
                        } catch (error) {
                          console.error('Failed to mark notification as read:', error);
                          // 실패 시 실시간 업데이트를 통해 자동으로 복원됨
                        }
                      }
                      
                      if (notification.url) {
                        window.electronAPI.openExternal(notification.url);
                      }
                    }}
                  >
                    <div className="card-body">
                      <div className="flex items-start space-x-3">
                        {/* 읽지않은 알림 표시 */}
                        {!notification.isRead && (
                          <div className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full mt-2 animate-pulse"></div>
                        )}
                        
                        {/* 프로필 이미지 */}
                        <div className="flex-shrink-0 relative">
                          {notification.profileImageUrl && notification.profileImageUrl.trim() !== '' ? (
                            <div className="relative">
                              <img
                                src={notification.profileImageUrl}
                                alt={`${notification.title} 프로필`}
                                className="w-10 h-10 rounded-full object-cover border-2 border-white/20 shadow-md"
                                onLoad={() => {
                                  console.log('✅ Profile image loaded:', notification.profileImageUrl);
                                }}
                                onError={(e) => {
                                  console.warn('❌ Profile image failed to load:', notification.profileImageUrl);
                                  // 이미지 로드 실패 시 기본 아이콘으로 대체
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  const fallback = target.nextElementSibling as HTMLElement;
                                  if (fallback) {
                                    fallback.classList.remove('hidden');
                                  }
                                }}
                              />
                              {/* 기본 아이콘 (프로필 이미지 로드 실패 시) */}
                              <div className="hidden w-10 h-10 rounded-full flex items-center justify-center text-lg bg-gradient-to-br from-gray-600 to-gray-800 border-2 border-white/20 shadow-md">
                                👤
                              </div>
                              {/* 플랫폼 뱃지 */}
                              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs ${getTypeColor(notification.type)} bg-gray-900 border border-white/30`}>
                                {getTypeIcon(notification.type)}
                              </div>
                            </div>
                          ) : (
                            /* 프로필 이미지가 없는 경우 */
                            <div className="relative">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg bg-gradient-to-br from-gray-600 to-gray-800 border-2 border-white/20 shadow-md">
                                👤
                              </div>
                              {/* 플랫폼 뱃지 */}
                              <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs ${getTypeColor(notification.type)} bg-gray-900 border border-white/30`}>
                                {getTypeIcon(notification.type)}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium text-white truncate">
                              {notification.title}
                            </h3>
                            <span className="text-xs text-gray-400 ml-2">
                              {formatDate(notification.createdAt)}
                            </span>
                          </div>
                          
                          {notification.content && (
                            <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                              {notification.content}
                            </p>
                          )}
                          
                          <div className="flex items-center mt-2 text-xs text-gray-500">
                            <span className={`px-2 py-1 rounded ${getTypeColor(notification.type)} bg-opacity-20`}>
                              {notification.type === 'live' ? '라이브' : 
                               notification.type === 'cafe' ? '카페' : '트위터'}
                            </span>
                            {notification.url && (
                              <span className="ml-2">🔗 클릭하여 열기</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationHistory;
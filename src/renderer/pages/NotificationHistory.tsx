import React, { useState, useEffect, useRef } from 'react';
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
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [paginatedNotifications, setPaginatedNotifications] = useState<NotificationRecord[]>([]);
  const [filterCounts, setFilterCounts] = useState({
    all: 0,
    live: 0,
    cafe: 0,
    twitter: 0
  });
  const [hasNewNotifications, setHasNewNotifications] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollButtonType, setScrollButtonType] = useState<'top' | 'bottom'>('top');
  const [lastScrollTop, setLastScrollTop] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsPerPage = 100;

  // 필터별 개수 로드
  const loadFilterCounts = async () => {
    try {
      const [allCount, liveCount, cafeCount, twitterCount] = await Promise.all([
        window.electronAPI.getTotalNotificationCount({ type: undefined }),
        window.electronAPI.getTotalNotificationCount({ type: 'live' }),
        window.electronAPI.getTotalNotificationCount({ type: 'cafe' }),
        window.electronAPI.getTotalNotificationCount({ type: 'twitter' })
      ]);
      
      setFilterCounts({
        all: allCount,
        live: liveCount,
        cafe: cafeCount,
        twitter: twitterCount
      });
    } catch (error) {
      console.error('Failed to load filter counts:', error);
    }
  };

  // 페이지네이션을 위한 알림 데이터 로드
  const loadNotifications = async (page: number = 1, filterType: string = 'all') => {
    try {
      setIsLoading(true);
      
      const offset = (page - 1) * itemsPerPage;
      const options = {
        limit: itemsPerPage,
        offset,
        type: filterType === 'all' ? undefined : filterType
      };
      
      // 총 개수와 페이지네이션된 데이터를 동시에 가져오기
      const [notificationsData, totalCountData] = await Promise.all([
        window.electronAPI.getNotifications(options),
        window.electronAPI.getTotalNotificationCount({ type: filterType === 'all' ? undefined : filterType })
      ]);
      
      setPaginatedNotifications(notificationsData);
      setTotalCount(totalCountData);
      setCurrentPage(page);
      
      console.log(`📄 Loaded page ${page}: ${notificationsData.length} items, total: ${totalCountData}`);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 초기 데이터 로드 및 필터 변경 시 리로드
  useEffect(() => {
    loadNotifications(1, filter);
    loadFilterCounts(); // 필터 개수도 함께 로드
    setHasNewNotifications(false); // 필터 변경 시 새 알림 플래그 리셋
  }, [filter]);

  // 페이지 변경 핸들러
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages && page !== currentPage) {
      loadNotifications(page, filter);
      // 첫 페이지로 이동하면 새 알림 플래그 리셋
      if (page === 1) {
        setHasNewNotifications(false);
      }
    }
  };

  // 새 알림 보기 핸들러
  const handleViewNewNotifications = () => {
    handlePageChange(1);
  };

  // 플로팅 스크롤 버튼 로직 (부드러운 등장/퇴장)
  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const scrollThreshold = 150; // 150px 스크롤 후 버튼 표시
      const bottomThreshold = 100; // 하단 100px 전에서 버튼 타입 변경

      // 스크롤 가능한 높이가 충분하지 않으면 버튼 숨김
      if (scrollHeight <= clientHeight + 100) {
        setShowScrollButton(false);
        setLastScrollTop(scrollTop);
        return;
      }

      const maxScroll = scrollHeight - clientHeight;
      const scrollProgress = scrollTop / maxScroll;
      const isNearTop = scrollTop < scrollThreshold;
      const isNearBottom = scrollTop > maxScroll - bottomThreshold;

      // 🎯 핵심 UX: 상단에서는 완전히 숨김, 스크롤 시작하면 부드럽게 등장
      if (isNearTop) {
        setShowScrollButton(false);
      } else {
        setShowScrollButton(true);
        
        // 버튼 타입 결정
        if (isNearBottom) {
          setScrollButtonType('top');
        } else if (scrollProgress < 0.5) {
          setScrollButtonType('bottom');
        } else {
          setScrollButtonType('top');
        }
      }

      setLastScrollTop(scrollTop);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      // 초기 스크롤 상태 체크 (처음에는 숨김)
      handleScroll();
    }

    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, [paginatedNotifications.length]);

  // 플로팅 스크롤 함수
  const handleFloatingScroll = async () => {
    console.log('🔘 Scroll button clicked!', {
      containerExists: !!containerRef.current,
      isAnimating,
      scrollButtonType,
      currentScrollTop: containerRef.current?.scrollTop,
      scrollHeight: containerRef.current?.scrollHeight
    });

    if (!containerRef.current || isAnimating) {
      console.log('❌ Scroll blocked:', { containerExists: !!containerRef.current, isAnimating });
      return;
    }

    setIsAnimating(true);

    try {
      if (scrollButtonType === 'top') {
        console.log('⬆️ Scrolling to top');
        
        // 다중 스크롤 시도 (브라우저 호환성)
        const scrollOptions = { top: 0, behavior: 'smooth' as ScrollBehavior };
        
        // 1. 기본 scrollTo 시도
        containerRef.current.scrollTo(scrollOptions);
        
        // 2. 백업: scrollTop 직접 설정 (애니메이션 없음)
        setTimeout(() => {
          if (containerRef.current && containerRef.current.scrollTop > 50) {
            console.log('🔄 Fallback: Direct scroll to top');
            containerRef.current.scrollTop = 0;
          }
        }, 100);
        
      } else if (scrollButtonType === 'bottom') {
        console.log('⬇️ Scrolling to bottom');
        
        const maxScroll = containerRef.current.scrollHeight - containerRef.current.clientHeight;
        const scrollOptions = { top: maxScroll, behavior: 'smooth' as ScrollBehavior };
        
        // 1. 기본 scrollTo 시도
        containerRef.current.scrollTo(scrollOptions);
        
        // 2. 백업: scrollTop 직접 설정
        setTimeout(() => {
          if (containerRef.current && containerRef.current.scrollTop < maxScroll - 50) {
            console.log('🔄 Fallback: Direct scroll to bottom');
            containerRef.current.scrollTop = maxScroll;
          }
        }, 100);
      }

      // 스크롤 완료 확인
      setTimeout(() => {
        console.log('📍 Scroll completed, new position:', containerRef.current?.scrollTop);
      }, 1000);

    } catch (error) {
      console.error('❌ Scroll error:', error);
      
      // 최종 백업: 직접 스크롤
      if (containerRef.current) {
        if (scrollButtonType === 'top') {
          containerRef.current.scrollTop = 0;
        } else {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }
    }

    // 애니메이션 완료 후 상태 초기화
    setTimeout(() => {
      setIsAnimating(false);
    }, 800);
  };

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
      
      // 실시간 업데이트를 위한 스마트 리로딩
      // 1. 필터 카운트는 항상 업데이트 (새 알림 시 총 개수 변경 반영)
      loadFilterCounts();
      
      // 2. 현재 페이지 데이터 업데이트 결정
      if (currentPage === 1) {
        // 첫 페이지인 경우: 새 알림이 맨 위에 나타나야 하므로 즉시 리로드
        console.log('🔄 Reloading first page due to new notifications');
        loadNotifications(1, filter);
        setHasNewNotifications(false); // 첫 페이지 업데이트 시 플래그 리셋
      } else {
        // 다른 페이지인 경우: 새 알림 있음을 표시하고 총 개수만 업데이트
        console.log(`📊 New notifications available, currently on page ${currentPage}`);
        setHasNewNotifications(true);
        
        // 현재 총 개수를 다시 가져와서 페이지 정보 업데이트
        window.electronAPI.getTotalNotificationCount({ 
          type: filter === 'all' ? undefined : filter 
        }).then(newTotalCount => {
          setTotalCount(newTotalCount);
        }).catch(console.error);
      }
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
  }, [onNotificationsUpdate, currentPage, filter]);

  // 페이지네이션된 데이터를 사용 (필터는 서버에서 처리됨)
  const filteredNotifications = paginatedNotifications;

  // 페이지 정보 계산
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;


  const handleClearAll = async () => {
    if (!confirm('모든 알림 기록을 삭제하시겠습니까?')) {
      return;
    }

    try {
      await window.electronAPI.deleteAllNotifications();
      // 데이터 다시 로드
      await loadNotifications(1, filter);
      await loadFilterCounts();
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
    <div 
      ref={containerRef}
      className="h-full overflow-auto scrollbar-neon relative"
    >
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
                {hasNewNotifications && currentPage !== 1 && (
                  <button
                    onClick={handleViewNewNotifications}
                    className="new-notification-btn"
                  >
                    <span className="relative z-10">🔔 새 알림 보기</span>
                  </button>
                )}
                <button
                  onClick={handleClearAll}
                  className="btn btn-danger"
                  disabled={filterCounts.all === 0}
                >
                  🗑️ 모두 삭제
                </button>
              </div>
            </div>

            {/* 필터 */}
            <div className="flex space-x-2 mt-4">
              {[
                { key: 'all', label: '🔍 전체', count: filterCounts.all },
                { key: 'live', label: '📺 방송', count: filterCounts.live },
                { key: 'cafe', label: '💬 카페', count: filterCounts.cafe },
                { key: 'twitter', label: '🐦 트위터', count: filterCounts.twitter }
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
                          const updatedNotifications = paginatedNotifications.map(n => 
                            n.id === notification.id ? { ...n, isRead: true } : n
                          );
                          setPaginatedNotifications(updatedNotifications);
                          
                          // 2. 데이터베이스 업데이트
                          await window.electronAPI.markNotificationRead(notification.id);
                          
                        } catch (error) {
                          console.error('Failed to mark notification as read:', error);
                          // 실패 시 데이터 다시 로드
                          loadNotifications(currentPage, filter);
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

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <div className="pagination-simple mt-8">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={!hasPrevPage || isLoading}
                className="pagination-btn-simple"
              >
                ← 이전
              </button>
              
              <div className="pagination-info">
                <div className="pagination-info-main">
                  {currentPage} / {totalPages}
                  {hasNewNotifications && currentPage !== 1 && (
                    <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs badge-danger neon-pulse">
                      새 알림
                    </span>
                  )}
                </div>
                <div className="pagination-info-sub">
                  총 {totalCount}개 알림
                </div>
              </div>
              
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={!hasNextPage || isLoading}
                className="pagination-btn-simple"
              >
                다음 →
              </button>
            </div>
          )}

          {/* 로딩 인디케이터 */}
          {isLoading && (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
              <span className="ml-2 text-gray-400">로딩 중...</span>
            </div>
          )}
        </div>
      </div>

      {/* 플로팅 스크롤 버튼 */}
      {showScrollButton && (
        <button
          onClick={handleFloatingScroll}
          className={`floating-scroll-btn ${isAnimating ? 'animating' : ''}`}
          title={scrollButtonType === 'top' ? '맨 위로' : '맨 아래로'}
          disabled={isAnimating}
        >
          <div className="floating-scroll-icon">
            {scrollButtonType === 'top' ? '↑' : '↓'}
          </div>
          <div className="floating-scroll-ripple"></div>
        </button>
      )}
    </div>
  );
};

export default NotificationHistory;
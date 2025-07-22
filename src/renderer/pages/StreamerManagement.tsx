import React, { useState } from 'react';
import { StreamerData, LiveStatus } from '@shared/types';
import StreamerCard from '../components/StreamerCard';
import AddStreamerForm from '../components/AddStreamerForm';

interface StreamerManagementProps {
  streamers: StreamerData[];
  liveStatuses: LiveStatus[];
  liveStreamersCount: number;
  onAdd: (streamerData: Omit<StreamerData, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onUpdate: (streamerData: StreamerData) => Promise<void>;
  onDelete: (streamerId: number) => Promise<void>;
}

const StreamerManagement: React.FC<StreamerManagementProps> = ({
  streamers,
  liveStatuses,
  liveStreamersCount,
  onAdd,
  onUpdate,
  onDelete
}) => {
  console.log('🏠 StreamerManagement page rendering...');
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleAdd = async (streamerData: Omit<StreamerData, 'id' | 'createdAt' | 'updatedAt'>) => {
    setIsLoading(true);
    try {
      await onAdd(streamerData);
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to add streamer:', error);
      alert('스트리머 추가에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (streamerData: StreamerData) => {
    setIsLoading(true);
    try {
      await onUpdate(streamerData);
    } catch (error) {
      console.error('Failed to update streamer:', error);
      alert('스트리머 정보 업데이트에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (streamerId: number) => {
    if (!confirm('정말로 이 스트리머를 삭제하시겠습니까?')) {
      return;
    }

    setIsLoading(true);
    try {
      await onDelete(streamerId);
    } catch (error) {
      console.error('Failed to delete streamer:', error);
      alert('스트리머 삭제에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  // 라이브 상태별 정렬 함수
  const sortStreamersWithLiveStatus = (streamers: StreamerData[]) => {
    return streamers.sort((a, b) => {
      const aLiveStatus = liveStatuses.find(ls => ls.streamerId === a.id);
      const bLiveStatus = liveStatuses.find(ls => ls.streamerId === b.id);
      
      // 라이브 중인 스트리머를 먼저 배치
      if (aLiveStatus?.isLive && !bLiveStatus?.isLive) return -1;
      if (!aLiveStatus?.isLive && bLiveStatus?.isLive) return 1;
      
      // 같은 라이브 상태면 이름순으로 정렬
      return a.name.localeCompare(b.name);
    });
  };

  const activeStreamers = sortStreamersWithLiveStatus(streamers.filter(s => s.isActive));
  const inactiveStreamers = sortStreamersWithLiveStatus(streamers.filter(s => !s.isActive));

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
                    📺 스트리머 관리
                  </h1>
                  <p className="text-gray-400">
                    스트리머를 추가하고 알림 설정을 관리하세요
                  </p>
                </div>
                
                <button
                  onClick={() => setShowAddForm(true)}
                  className="btn btn-primary"
                  disabled={isLoading}
                >
                  <span className="mr-2">➕</span>
                  새 스트리머 추가
                </button>
              </div>

              {/* 통계 카드 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card">
                  <div className="card-body">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-400">전체 스트리머</p>
                        <p className="text-3xl font-bold text-white mt-1">{streamers.length}</p>
                      </div>
                      <div className="text-3xl">👥</div>
                    </div>
                  </div>
                </div>
                
                <div className="card">
                  <div className="card-body">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-400">활성 스트리머</p>
                        <p className="text-3xl font-bold text-green-400 mt-1">{activeStreamers.length}</p>
                      </div>
                      <div className="text-3xl">✅</div>
                    </div>
                  </div>
                </div>
                
                <div className="card">
                  <div className="card-body">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-400">현재 라이브</p>
                        <p className="text-3xl font-bold text-red-400 mt-1">{liveStreamersCount}</p>
                      </div>
                      <div className="text-3xl">🔴</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 스트리머 목록 */}
          <div className="space-y-6">
            {streamers.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-8xl mb-6">📺</div>
                <h3 className="text-2xl font-semibold text-white mb-3">
                  등록된 스트리머가 없습니다
                </h3>
                <p className="text-lg text-gray-400 mb-8 max-w-md mx-auto">
                  새 스트리머를 추가하여 실시간 알림을 받아보세요
                </p>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="btn btn-primary"
                >
                  <span className="mr-2">✨</span>
                  첫 번째 스트리머 추가하기
                </button>
              </div>
            ) : (
              <div className="space-y-8">
                {/* 활성 스트리머 */}
                {activeStreamers.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <h2 className="text-2xl font-semibold text-white">
                        활성 스트리머
                      </h2>
                      <span className="px-3 py-1 bg-green-500/20 text-green-300 text-sm font-medium rounded-full">
                        {activeStreamers.length}명
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-6">
                      {activeStreamers.map((streamer) => {
                        const liveStatus = liveStatuses.find(ls => ls.streamerId === streamer.id);
                        return (
                          <StreamerCard
                            key={streamer.id}
                            streamer={streamer}
                            liveStatus={liveStatus}
                            onUpdate={handleUpdate}
                            onDelete={() => handleDelete(streamer.id)}
                            disabled={isLoading}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 비활성 스트리머 */}
                {inactiveStreamers.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                      <h2 className="text-2xl font-semibold text-white">
                        비활성 스트리머
                      </h2>
                      <span className="px-3 py-1 bg-gray-500/20 text-gray-300 text-sm font-medium rounded-full">
                        {inactiveStreamers.length}명
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-6">
                      {inactiveStreamers.map((streamer) => {
                        const liveStatus = liveStatuses.find(ls => ls.streamerId === streamer.id);
                        return (
                          <StreamerCard
                            key={streamer.id}
                            streamer={streamer}
                            liveStatus={liveStatus}
                            onUpdate={handleUpdate}
                            onDelete={() => handleDelete(streamer.id)}
                            disabled={isLoading}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 스트리머 추가 모달 */}
          {showAddForm && (
            <AddStreamerForm
              onSubmit={handleAdd}
              onCancel={() => setShowAddForm(false)}
              isLoading={isLoading}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default StreamerManagement;
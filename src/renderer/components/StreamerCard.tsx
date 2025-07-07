import React, { useState } from 'react';
import { StreamerData } from '@shared/types';

interface StreamerCardProps {
  streamer: StreamerData;
  onUpdate: (streamerData: StreamerData) => Promise<void>;
  onDelete: () => void;
  disabled: boolean;
}

const StreamerCard: React.FC<StreamerCardProps> = ({
  streamer,
  onUpdate,
  onDelete,
  disabled
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editData, setEditData] = useState<StreamerData>(streamer);

  const handleSave = async () => {
    await onUpdate(editData);
    setIsModalOpen(false);
  };

  const handleCancel = () => {
    setEditData(streamer); // 원래 데이터로 복원
    setIsModalOpen(false);
  };

  const handleEdit = () => {
    setEditData(streamer); // 최신 데이터로 설정
    setIsModalOpen(true);
  };

  return (
    <>
      {/* 스트리머 카드 */}
    <div className={`glass-card p-6 hover-lift transition-all duration-300 ${!streamer.isActive ? 'opacity-60' : 'hover-glow'}`}>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4">
            {streamer.profileImageUrl ? (
              <img
                src={streamer.profileImageUrl}
                alt={streamer.name}
                className="w-16 h-16 rounded-full object-cover border-2 border-white/20 shadow-lg"
                onError={(e) => {
                  // 이미지 로드 실패 시 기본 아이콘으로 대체
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  target.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            {/* 기본 아이콘 (프로필 이미지 없거나 로드 실패 시 표시) */}
            <div className={`w-16 h-16 gradient-primary rounded-full flex items-center justify-center shadow-lg animate-glow ${
              streamer.profileImageUrl ? 'hidden' : ''
            }`}>
              <span className="text-2xl">👤</span>
            </div>
            <div>
              <h3 className="font-bold text-white text-xl">{streamer.name}</h3>
              <div className="flex items-center flex-wrap gap-2 mt-2">
                {streamer.chzzkId && (
                  <span className="badge badge-danger platform-chzzk whitespace-nowrap" title="치지직">
                    📺 CHZZK
                  </span>
                )}
                {streamer.twitterUsername && (
                  <span className="badge badge-primary platform-twitter whitespace-nowrap" title="트위터">
                    🐦 Twitter
                  </span>
                )}
                {streamer.naverCafeUserId && (
                  <span className="badge badge-success platform-cafe whitespace-nowrap" title="네이버 카페">
                    💬 Cafe
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center">
            <span className={`px-4 py-2 rounded-full text-sm font-semibold backdrop-blur-sm ${
              streamer.isActive 
                ? 'bg-green-500/20 text-green-300 border border-green-500/30 animate-glow' 
                : 'bg-gray-500/20 text-gray-300 border border-gray-500/30'
            }`}>
              {streamer.isActive ? '✅ 활성' : '⏸️ 비활성'}
            </span>
          </div>
        </div>
        
        <div className="flex space-x-4 pt-2">
          <button
            onClick={handleEdit}
            className="flex-1 btn btn-ghost"
            disabled={disabled}
          >
            ✏️ 편집
          </button>
          <button
            onClick={onDelete}
            className="btn btn-danger"
            disabled={disabled}
          >
            🗑️ 삭제
          </button>
        </div>
      </div>
    </div>

      {/* 편집 모달 */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-up">
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-white neon-text">스트리머 정보 수정</h3>
                <p className="text-gray-400 text-sm mt-2">정보를 수정하고 저장하세요</p>
              </div>
              
              <div className="input-group">
                <label className="input-label">
                  ✨ 스트리머 이름
                </label>
                <input
                  type="text"
                  value={editData.name}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  className="input"
                  placeholder="스트리머 이름을 입력하세요"
                />
              </div>
              
              <div className="input-group">
                <label className="input-label">
                  📺 치지직 ID
                </label>
                <input
                  type="text"
                  value={editData.chzzkId || ''}
                  onChange={(e) => setEditData({ ...editData, chzzkId: e.target.value })}
                  className="input"
                  placeholder="치지직 채널 ID"
                />
              </div>
              
              <div className="input-group">
                <label className="input-label">
                  🐦 트위터 사용자명
                </label>
                <input
                  type="text"
                  value={editData.twitterUsername || ''}
                  onChange={(e) => setEditData({ ...editData, twitterUsername: e.target.value })}
                  className="input"
                  placeholder="@없이 사용자명만 입력"
                />
              </div>
              
              <div className="input-group">
                <label className="input-label">
                  💬 네이버 카페 사용자 ID
                </label>
                <input
                  type="text"
                  value={editData.naverCafeUserId || ''}
                  onChange={(e) => setEditData({ ...editData, naverCafeUserId: e.target.value })}
                  className="input"
                  placeholder="네이버 카페 사용자 ID"
                />
              </div>
              
              <div className="input-group">
                <label className="input-label">
                  🏢 카페 클럽 ID
                </label>
                <input
                  type="text"
                  value={editData.cafeClubId || ''}
                  onChange={(e) => setEditData({ ...editData, cafeClubId: e.target.value })}
                  className="input"
                  placeholder="예: 30919539"
                />
              </div>

              {/* 알림 설정 */}
              <div className="space-y-4">
                <h4 className="text-lg font-semibold text-white">알림 설정</h4>
                
                <label className="flex items-center space-x-4 p-4 glass rounded-xl hover-glow cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editData.notifications?.chzzk || false}
                    onChange={(e) => setEditData({ 
                      ...editData, 
                      notifications: { 
                        ...editData.notifications, 
                        chzzk: e.target.checked 
                      } 
                    })}
                    className="w-5 h-5 text-red-600 bg-transparent border-2 border-red-500/50 rounded focus:ring-red-500/50 focus:ring-2"
                  />
                  <span className="text-red-400 text-lg">📺</span>
                  <span className="text-sm font-semibold text-gray-200">치지직 라이브 알림</span>
                </label>

                <label className="flex items-center space-x-4 p-4 glass rounded-xl hover-glow cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editData.notifications?.twitter || false}
                    onChange={(e) => setEditData({ 
                      ...editData, 
                      notifications: { 
                        ...editData.notifications, 
                        twitter: e.target.checked 
                      } 
                    })}
                    className="w-5 h-5 text-blue-600 bg-transparent border-2 border-blue-500/50 rounded focus:ring-blue-500/50 focus:ring-2"
                  />
                  <span className="text-blue-400 text-lg">🐦</span>
                  <span className="text-sm font-semibold text-gray-200">트위터 알림</span>
                </label>

                <label className="flex items-center space-x-4 p-4 glass rounded-xl hover-glow cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editData.notifications?.cafe || false}
                    onChange={(e) => setEditData({ 
                      ...editData, 
                      notifications: { 
                        ...editData.notifications, 
                        cafe: e.target.checked 
                      } 
                    })}
                    className="w-5 h-5 text-green-600 bg-transparent border-2 border-green-500/50 rounded focus:ring-green-500/50 focus:ring-2"
                  />
                  <span className="text-green-400 text-lg">💬</span>
                  <span className="text-sm font-semibold text-gray-200">네이버 카페 알림</span>
                </label>
              </div>
              
              <label className="flex items-center space-x-4 p-4 glass rounded-xl hover-glow cursor-pointer">
                <input
                  type="checkbox"
                  checked={editData.isActive}
                  onChange={(e) => setEditData({ ...editData, isActive: e.target.checked })}
                  className="w-5 h-5 text-purple-600 bg-transparent border-2 border-purple-500/50 rounded focus:ring-purple-500/50 focus:ring-2"
                />
                <span className="text-sm font-semibold text-gray-200">🚀 활성화 상태</span>
              </label>
              
              <div className="flex space-x-4 pt-4">
                <button
                  onClick={handleSave}
                  className="flex-1 btn btn-success"
                  disabled={disabled}
                >
                  💾 저장하기
                </button>
                <button
                  onClick={handleCancel}
                  className="flex-1 btn btn-ghost"
                  disabled={disabled}
                >
                  ❌ 취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StreamerCard;
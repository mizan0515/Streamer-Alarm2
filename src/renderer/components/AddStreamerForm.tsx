import React, { useState } from 'react';
import { StreamerData } from '@shared/types';

interface AddStreamerFormProps {
  onSubmit: (streamerData: Omit<StreamerData, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
}

const AddStreamerForm: React.FC<AddStreamerFormProps> = ({
  onSubmit,
  onCancel,
  isLoading
}) => {
  const [formData, setFormData] = useState({
    name: '',
    chzzkId: '',
    twitterUsername: '',
    naverCafeUserId: '',
    cafeClubId: '',
    profileImageUrl: '',
    isActive: true,
    notifications: {
      chzzk: true,
      cafe: true,
      twitter: true
    }
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = '스트리머 이름은 필수입니다';
    }

    if (!formData.chzzkId && !formData.twitterUsername && !formData.naverCafeUserId) {
      newErrors.platforms = '최소 하나의 플랫폼 정보는 입력해야 합니다';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      await onSubmit(formData);
    } catch (error) {
      console.error('Failed to add streamer:', error);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // 에러 제거
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleNotificationChange = (platform: string, enabled: boolean) => {
    setFormData(prev => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [platform]: enabled
      }
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          {/* 헤더 */}
          <div className="p-6 border-b border-gray-700">
            <h2 className="text-xl font-semibold text-white">새 스트리머 추가</h2>
            <p className="text-gray-400 text-sm mt-1">
              스트리머 정보를 입력하고 알림 설정을 선택하세요
            </p>
          </div>

          {/* 폼 내용 */}
          <div className="p-6 space-y-4">
            {/* 기본 정보 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                🎭 스트리머 이름 *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className={`input ${errors.name ? 'border-red-500' : ''}`}
                placeholder="예: 아리사"
                disabled={isLoading}
              />
              {errors.name && (
                <p className="text-red-400 text-xs mt-1">{errors.name}</p>
              )}
            </div>

            {/* 플랫폼 정보 */}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  📺 치지직 ID
                </label>
                <input
                  type="text"
                  value={formData.chzzkId}
                  onChange={(e) => handleInputChange('chzzkId', e.target.value)}
                  className="input"
                  placeholder="예: 4de764d9dad3b25602284be6db3ac647"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  🐦 트위터 사용자명
                </label>
                <input
                  type="text"
                  value={formData.twitterUsername}
                  onChange={(e) => handleInputChange('twitterUsername', e.target.value)}
                  className="input"
                  placeholder="예: Aesther_Arisa (@없이)"
                  disabled={isLoading}
                />
                <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-2 mt-2">
                  <div className="flex items-start space-x-2">
                    <span className="text-blue-400 mt-0.5">ℹ️</span>
                    <div className="text-xs text-blue-300">
                      <p>트위터 모니터링을 위해서는 <strong>설정 &gt; 계정 관리</strong>에서 트위터 계정 로그인이 필요합니다.</p>
                      <p className="mt-1">로그인 후 자동으로 트윗을 스크래핑하여 실시간 알림을 제공합니다.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  💬 네이버 카페 사용자 ID
                </label>
                <input
                  type="text"
                  value={formData.naverCafeUserId}
                  onChange={(e) => handleInputChange('naverCafeUserId', e.target.value)}
                  className="input"
                  placeholder="예: cuEWXUyMqKzQGLwr3RwrXw"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  🏢 카페 클럽 ID
                </label>
                <input
                  type="text"
                  value={formData.cafeClubId}
                  onChange={(e) => handleInputChange('cafeClubId', e.target.value)}
                  className="input"
                  placeholder="예: 30919539 (스트리머가 활동하는 카페의 클럽 ID)"
                  disabled={isLoading}
                />
                <p className="text-xs text-gray-400 mt-1">
                  💡 카페 URL에서 확인: cafe.naver.com/ca-fe/cafes/<strong>클럽ID</strong>/...
                </p>
              </div>

              {errors.platforms && (
                <p className="text-red-400 text-xs">{errors.platforms}</p>
              )}
            </div>

            {/* 알림 설정 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                🔔 개별 알림 설정
              </label>
              <div className="space-y-2">
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={formData.notifications.chzzk}
                    onChange={(e) => handleNotificationChange('chzzk', e.target.checked)}
                    className="rounded"
                    disabled={isLoading}
                  />
                  <span className="text-sm text-gray-300">📺 스트리밍 알림</span>
                </label>
                
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={formData.notifications.twitter}
                    onChange={(e) => handleNotificationChange('twitter', e.target.checked)}
                    className="rounded"
                    disabled={isLoading}
                  />
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-300">🐦 트위터 알림</span>
                    <span className="text-xs text-yellow-400">로그인 필요</span>
                  </div>
                </label>
                
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={formData.notifications.cafe}
                    onChange={(e) => handleNotificationChange('cafe', e.target.checked)}
                    className="rounded"
                    disabled={isLoading}
                  />
                  <span className="text-sm text-gray-300">💬 카페 알림</span>
                </label>
              </div>
            </div>

            {/* 활성화 설정 */}
            <div>
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => handleInputChange('isActive', e.target.checked)}
                  className="rounded"
                  disabled={isLoading}
                />
                <span className="text-sm text-gray-300">✅ 활성화 (모니터링 대상에 포함)</span>
              </label>
            </div>
          </div>

          {/* 푸터 */}
          <div className="p-6 border-t border-gray-700 flex space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-ghost flex-1"
              disabled={isLoading}
            >
              취소
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner spinner-sm mr-2"></span>
                  추가 중...
                </>
              ) : (
                '추가'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddStreamerForm;
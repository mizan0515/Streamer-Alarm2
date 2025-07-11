import axios, { AxiosInstance } from 'axios';
import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { StreamerData, LiveStatus } from '@shared/types';

interface ChzzkLiveResponse {
  code: number;
  message: string | null;
  content: {
    liveId: string | null;
    liveTitle: string;
    status: 'OPEN' | 'CLOSE';
    liveImageUrl: string;
    defaultThumbnailImageUrl: string | null;
    concurrentUserCount: number;
    accumulateCount: number;
    openDate: string;
    closeDate: string | null;
    adult: boolean;
    tags: string[];
    categoryType: string | null;
    liveCategory: string | null;
    liveCategoryValue: string | null;
    channel: {
      channelId: string;
      channelName: string;
      channelImageUrl: string;
      verifiedMark: boolean;
    };
  } | null;
}

interface ChzzkChannelResponse {
  code: number;
  message: string | null;
  content: {
    channelId: string;
    channelName: string;
    channelImageUrl: string;
    verifiedMark: boolean;
    channelDescription: string;
    followerCount: number;
    openLive: boolean;
  };
}

export class ChzzkMonitor {
  private httpClient: AxiosInstance;
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private previousLiveStatus: Map<string, boolean> = new Map();

  constructor(databaseManager: DatabaseManager, notificationService: NotificationService) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    
    // CHZZK API 클라이언트 설정
    this.httpClient = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Referer': 'https://chzzk.naver.com/',
        'Origin': 'https://chzzk.naver.com'
      }
    });
  }

  async checkAllStreamers(silentMode: boolean = false): Promise<LiveStatus[]> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      const activeStreamers = streamers.filter(s => s.isActive && s.chzzkId);

      if (!silentMode) {
        console.log(`Checking ${activeStreamers.length} CHZZK streamers...`);
      }

      const liveStatuses: LiveStatus[] = [];
      
      // 병렬로 모든 스트리머 체크
      const promises = activeStreamers.map(async (streamer) => {
        try {
          const liveStatus = await this.checkStreamerLive(streamer);
          liveStatuses.push(liveStatus);
          
          // 상태 변화 감지 및 알림 발송 (silent mode에서는 알림 비활성화)
          if (!silentMode) {
            await this.handleStatusChange(streamer, liveStatus);
          }
          
          return liveStatus;
        } catch (error) {
          console.error(`Failed to check ${streamer.name}:`, error);
          
          // 오류 시 오프라인으로 처리
          const offlineStatus: LiveStatus = {
            streamerId: streamer.id,
            streamerName: streamer.name,
            isLive: false
          };
          liveStatuses.push(offlineStatus);
          return offlineStatus;
        }
      });

      await Promise.all(promises);
      
      console.log(`CHZZK check completed. Live: ${liveStatuses.filter(s => s.isLive).length}/${liveStatuses.length}`);
      
      return liveStatuses;
    } catch (error) {
      console.error('Failed to check CHZZK streamers:', error);
      return [];
    }
  }

  private async checkStreamerLive(streamer: StreamerData): Promise<LiveStatus> {
    try {
      const liveResponse = await this.httpClient.get<ChzzkLiveResponse>(
        `https://api.chzzk.naver.com/polling/v2/channels/${streamer.chzzkId}/live-status`
      );

      if (liveResponse.data.code !== 200 || !liveResponse.data.content) {
        return {
          streamerId: streamer.id,
          streamerName: streamer.name,
          isLive: false
        };
      }

      const content = liveResponse.data.content;
      const isLive = content.status === 'OPEN';

      if (isLive) {
        return {
          streamerId: streamer.id,
          streamerName: streamer.name,
          isLive: true,
          title: content.liveTitle,
          url: `https://chzzk.naver.com/live/${streamer.chzzkId}`,
          thumbnailUrl: content.liveImageUrl || content.defaultThumbnailImageUrl || undefined
        };
      } else {
        return {
          streamerId: streamer.id,
          streamerName: streamer.name,
          isLive: false
        };
      }
    } catch (error) {
      console.error(`Error checking ${streamer.name} live status:`, error);
      
      return {
        streamerId: streamer.id,
        streamerName: streamer.name,
        isLive: false
      };
    }
  }

  private async handleStatusChange(streamer: StreamerData, currentStatus: LiveStatus): Promise<void> {
    // 데이터베이스에서 이전 상태 조회
    const previousState = await this.databaseManager.getMonitorState(streamer.id, 'chzzk');
    const previousStatus = previousState?.lastStatus === 'live';
    
    // 🚨 NEW: 새 스트리머 초기화 처리 (라이브 알림은 허용, 오프라인 상태만 차단)
    const isNewStreamer = !previousState;
    if (isNewStreamer) {
      console.log(`🆕 ${streamer.name}: 새 스트리머 감지됨 - 라이브 상태 확인 중`);
      
      // 현재 상태를 데이터베이스에 저장 (초기화 상태로)
      await this.databaseManager.setMonitorState(
        streamer.id,
        'chzzk',
        currentStatus.isLive ? (currentStatus.url || '') : undefined,
        currentStatus.isLive ? 'live' : 'offline'
      );
      
      // 메모리 캐시도 업데이트
      this.previousLiveStatus.set(streamer.id.toString(), currentStatus.isLive);
      
      if (currentStatus.isLive) {
        console.log(`🎉 ${streamer.name}: 새 스트리머 라이브 중 감지 - 라이브 알림 허용`);
        // 라이브 중이라면 알림 허용 (아래로 진행)
      } else {
        console.log(`🆕 ${streamer.name}: 새 스트리머 오프라인 상태로 초기화 완료`);
        return; // 오프라인 상태는 알림 차단
      }
    }
    
    // 상태가 변경되었고, 라이브가 시작된 경우에만 알림 발송
    if (!previousStatus && currentStatus.isLive) {
      // 최신 스트리머 정보 다시 조회 (알림 설정 동기화)
      const latestStreamers = await this.databaseManager.getStreamers();
      const latestStreamer = latestStreamers.find(s => s.id === streamer.id);
      
      // 스트리머별 알림 설정 확인 (최신 정보 기준)
      if (latestStreamer?.notifications?.chzzk && latestStreamer.isActive) {
        const notification = this.notificationService.createLiveNotification(
          latestStreamer.name,
          currentStatus.title || '라이브 스트리밍',
          currentStatus.url || `https://chzzk.naver.com/${latestStreamer.chzzkId}`,
          latestStreamer.profileImageUrl
        );

        await this.notificationService.sendNotification(notification);
        console.log(`Live notification sent for ${streamer.name}`);
      }
    }

    // 기존 스트리머의 경우에만 상태 저장 (새 스트리머는 이미 위에서 저장됨)
    if (!isNewStreamer) {
      await this.databaseManager.setMonitorState(
        streamer.id,
        'chzzk',
        currentStatus.isLive ? (currentStatus.url || '') : undefined,
        currentStatus.isLive ? 'live' : 'offline'
      );

      // 메모리 캐시도 업데이트 (호환성 유지)
      this.previousLiveStatus.set(streamer.id.toString(), currentStatus.isLive);
    }
  }

  async getProfileImage(chzzkId: string): Promise<string | null> {
    try {
      console.log(`🖼️ Fetching profile image for CHZZK ID: ${chzzkId}`);
      
      const response = await this.httpClient.get<ChzzkChannelResponse>(
        `https://api.chzzk.naver.com/service/v1/channels/${chzzkId}`
      );

      if (response.data.code === 200 && response.data.content) {
        const profileUrl = response.data.content.channelImageUrl;
        
        if (profileUrl && profileUrl.trim() !== '') {
          console.log(`✅ Profile image found: ${profileUrl.substring(0, 50)}...`);
          return profileUrl;
        } else {
          console.log('⚠️ Profile image URL is empty');
          return null;
        }
      } else {
        console.warn(`⚠️ Invalid CHZZK API response for ${chzzkId}:`, response.data.code, response.data.message);
        return null;
      }
    } catch (error) {
      console.error(`❌ Failed to get profile image for ${chzzkId}:`, error);
      return null;
    }
  }

  async updateStreamerProfile(streamer: StreamerData): Promise<void> {
    if (!streamer.chzzkId) return;

    try {
      const profileImageUrl = await this.getProfileImage(streamer.chzzkId);
      
      if (profileImageUrl && profileImageUrl !== streamer.profileImageUrl) {
        const updatedStreamer = { ...streamer, profileImageUrl };
        await this.databaseManager.updateStreamer(updatedStreamer);
        console.log(`Updated profile image for ${streamer.name}`);
      }
    } catch (error) {
      console.error(`Failed to update profile for ${streamer.name}:`, error);
    }
  }

  // 채널 정보 검증
  async validateChannelId(chzzkId: string): Promise<{ valid: boolean; channelName?: string; profileImage?: string }> {
    try {
      const response = await this.httpClient.get<ChzzkChannelResponse>(
        `https://api.chzzk.naver.com/service/v1/channels/${chzzkId}`
      );

      if (response.data.code === 200 && response.data.content) {
        return {
          valid: true,
          channelName: response.data.content.channelName,
          profileImage: response.data.content.channelImageUrl
        };
      }

      return { valid: false };
    } catch (error) {
      console.error(`Failed to validate channel ${chzzkId}:`, error);
      return { valid: false };
    }
  }

  // 특정 스트리머의 라이브 상태만 조용히 체크 (baseline 설정용)
  async checkSingleStreamerLive(streamer: StreamerData): Promise<LiveStatus | null> {
    try {
      return await this.checkStreamerLive(streamer);
    } catch (error) {
      console.error(`Failed to check live status for ${streamer.name}:`, error);
      return null;
    }
  }

  // 정리 작업
  cleanup(): void {
    this.previousLiveStatus.clear();
  }
}
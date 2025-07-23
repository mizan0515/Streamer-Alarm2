import axios, { AxiosInstance } from 'axios';
import * as Parser from 'rss-parser';
import { DatabaseManager } from './DatabaseManager';
import { NotificationService } from './NotificationService';
import { StreamerData, TwitterTweet } from '@shared/types';

interface RSSItem {
  title?: string;
  link?: string;
  pubDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
}

export class TwitterMonitor {
  private httpClient: AxiosInstance;
  private rssParser: Parser;
  private databaseManager: DatabaseManager;
  private notificationService: NotificationService;
  private settingsService: any; // SettingsService
  private lastTweetIds: Map<string, string> = new Map();

  // Nitter 인스턴스 목록 (백업 지원)
  private nitterInstances = [
    'https://nitter.dashy.a3x.dn.nyx.im',
    'https://nitter.net',
    'https://nitter.it',
    'https://nitter.privacydev.net',
    'https://nitter.poast.org'
  ];
  
  private currentInstanceIndex = 0;

  constructor(databaseManager: DatabaseManager, notificationService: NotificationService, settingsService?: any) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    this.settingsService = settingsService || null;
    
    // HTTP 클라이언트 설정
    this.httpClient = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
      }
    });

    // RSS 파서 설정
    this.rssParser = new Parser.default({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
  }

  async checkAllStreamers(silentMode: boolean = false): Promise<TwitterTweet[]> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      const activeStreamers = streamers.filter(s => s.isActive && s.twitterUsername);

      if (!silentMode) {
        console.log(`Checking ${activeStreamers.length} Twitter streamers...`);
      }

      const allTweets: TwitterTweet[] = [];
      
      // 순차적으로 스트리머 체크 (Nitter 인스턴스 부하 분산)
      for (const streamer of activeStreamers) {
        try {
          const tweets = await this.checkStreamerTweets(streamer);
          allTweets.push(...tweets);
          
          // 새 트윗 알림 처리 (silent mode에서는 알림 비활성화)
          if (!silentMode) {
            await this.handleNewTweets(streamer, tweets);
          }
          
          // 요청 간 딜레이 (API 부하 방지)
          await this.delay(1000);
        } catch (error) {
          console.error(`Failed to check ${streamer.name} tweets:`, error);
        }
      }

      if (!silentMode) {
        console.log(`Twitter check completed. New tweets: ${allTweets.length}`);
      }
      
      return allTweets;
    } catch (error) {
      console.error('Failed to check Twitter streamers:', error);
      return [];
    }
  }

  private async checkStreamerTweets(streamer: StreamerData): Promise<TwitterTweet[]> {
    if (!streamer.twitterUsername) return [];

    try {
      const rssUrl = await this.buildRSSUrl(streamer.twitterUsername);
      const feed = await this.fetchRSSFeed(rssUrl);
      
      if (!feed?.items) return [];

      const tweets: TwitterTweet[] = [];
      
      // 데이터베이스에서 마지막 트윗 ID 조회
      const lastState = await this.databaseManager.getMonitorState(streamer.id, 'twitter');
      const lastTweetId = lastState?.lastContentId || this.lastTweetIds.get(streamer.twitterUsername);

      // 🚨 NEW: 새 스트리머 초기화 처리 (과거 알림 폭탄 방지)
      const isNewStreamer = !lastTweetId;
      if (isNewStreamer && feed.items.length > 0) {
        console.log(`🆕 ${streamer.name}: 새 스트리머 감지됨 - 과거 알림 차단 모드 활성화`);
        
        // 최신 트윗 ID만 저장하고 알림은 차단
        const latestTweet = this.parseRSSItem(feed.items[0], streamer.twitterUsername);
        if (latestTweet) {
          await this.databaseManager.setMonitorState(
            streamer.id,
            'twitter',
            latestTweet.id, // 현재 최신 트윗을 기준점으로 설정
            'initialized'
          );
          this.lastTweetIds.set(streamer.twitterUsername, latestTweet.id);
          console.log(`🆕 ${streamer.name}: 초기 기준점 설정 완료 (ID: ${latestTweet.id})`);
        }
        
        // 새 스트리머는 빈 배열 반환 (과거 알림 차단)
        return [];
      }

      // 최신 20개 트윗 처리
      for (const item of feed.items.slice(0, 20)) {
        const tweet = this.parseRSSItem(item, streamer.twitterUsername);
        if (!tweet) continue;

        // 새 트윗인지 확인 (ID 기반 - 숫자 비교)
        if (lastTweetId && this.compareTwitterIds(tweet.id, lastTweetId) > 0) {
          // 🚨 NEW: 시간 기반 이중 필터링 (설정 가능한 시간 내 트윗만)
          const tweetTime = new Date(tweet.timestamp);
          const now = new Date();
          const timeDiff = now.getTime() - tweetTime.getTime();
          const hoursAgo = timeDiff / (1000 * 60 * 60);
          const filterHours = this.settingsService ? parseInt(this.settingsService.getSetting('newStreamerFilterHours')) : 24;
          
          if (hoursAgo > filterHours) {
            console.log(`⏰ ${streamer.name}: ${filterHours}시간 이상 경과 트윗 차단 (${hoursAgo.toFixed(1)}시간 전)`);
            continue;
          }
          
          tweets.push(tweet);
        }
      }

      return tweets.reverse(); // 시간순 정렬
    } catch (error) {
      console.error(`Error checking tweets for ${streamer.name}:`, error);
      return [];
    }
  }

  private async buildRSSUrl(username: string): Promise<string> {
    const currentInstance = this.nitterInstances[this.currentInstanceIndex];
    return `${currentInstance}/${username}/rss`;
  }

  private async fetchRSSFeed(url: string, retryCount = 0): Promise<Parser.Output<any> | null> {
    try {
      const response = await this.httpClient.get(url);
      const feed = await this.rssParser.parseString(response.data);
      return feed;
    } catch (error: any) {
      // RSS fetch 에러 로그 간소화 - 핵심 정보만 표시
      const errorMsg = error?.response?.status 
        ? `HTTP ${error.response.status}` 
        : error?.code || error?.message || 'Unknown error';
      console.error(`RSS fetch failed for ${url}: ${errorMsg}`);
      
      // 다른 Nitter 인스턴스로 재시도
      if (retryCount < this.nitterInstances.length - 1) {
        this.currentInstanceIndex = (this.currentInstanceIndex + 1) % this.nitterInstances.length;
        const newUrl = url.replace(/https:\/\/[^\/]+/, this.nitterInstances[this.currentInstanceIndex]);
        console.log(`Retrying with instance: ${this.nitterInstances[this.currentInstanceIndex]}`);
        
        await this.delay(2000); // 재시도 전 대기
        return await this.fetchRSSFeed(newUrl, retryCount + 1);
      }
      
      return null;
    }
  }

  private parseRSSItem(item: RSSItem, username: string): TwitterTweet | null {
    try {
      if (!item.link || !item.title || !item.pubDate) return null;

      // 트윗 ID 추출
      const tweetIdMatch = item.link.match(/status\/(\d+)/);
      if (!tweetIdMatch) return null;

      const tweetId = tweetIdMatch[1];

      // HTML 원본에서 이미지 및 미디어 링크 추출
      let contentHtml = item.content || item.title || '';
      contentHtml = this.enhanceContentWithMedia(contentHtml, username, tweetId);
      
      // 내용 정제 (알림 표시용)
      let content = item.contentSnippet || item.title || '';
      content = this.cleanTweetContent(content);

      // 실제 X.com URL로 변환
      const realUrl = `https://x.com/${username}/status/${tweetId}`;

      // RSS pubDate 파싱 (안전한 방식)
      const originalTimestamp = this.parseTwitterDate(item.pubDate);
      // RSS 파싱 로그 간소화 - 개별 트윗 내용은 생략

      return {
        id: tweetId,
        content: content,
        contentHtml: contentHtml,
        url: realUrl,
        timestamp: originalTimestamp.toISOString()
      };
    } catch (error) {
      console.error('Failed to parse RSS item:', error);
      return null;
    }
  }

  // 트위터 RSS pubDate 파싱 함수
  private parseTwitterDate(pubDate: string): Date {
    try {
      // RSS pubDate 형식: "Wed, 08 Jul 2025 07:30:00 +0000"
      const parsedDate = new Date(pubDate);
      
      // 유효한 날짜인지 확인
      if (isNaN(parsedDate.getTime())) {
        console.warn(`Invalid Twitter pubDate: ${pubDate}, using current time`);
        return new Date();
      }

      return parsedDate;
    } catch (error) {
      console.error(`Error parsing Twitter pubDate: ${pubDate}`, error);
      return new Date(); // 백업으로 현재 시간 사용
    }
  }

  private cleanTweetContent(content: string): string {
    // HTML 태그 제거
    content = content.replace(/<[^>]*>/g, '');
    
    // HTML 엔티티 디코딩
    content = content
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    // 길이 제한 (150자)
    if (content.length > 150) {
      content = content.substring(0, 147) + '...';
    }
    
    return content.trim();
  }

  private async handleNewTweets(streamer: StreamerData, tweets: TwitterTweet[]): Promise<void> {
    if (tweets.length === 0) return;

    // 최신 스트리머 정보 다시 조회 (알림 설정 동기화)
    const latestStreamers = await this.databaseManager.getStreamers();
    const latestStreamer = latestStreamers.find(s => s.id === streamer.id);

    // 스트리머별 트위터 알림 설정 확인 (최신 정보 기준)
    if (!latestStreamer?.notifications?.twitter || !latestStreamer.isActive) return;

    // 데이터베이스에서 마지막 트윗 ID 조회
    const lastState = await this.databaseManager.getMonitorState(streamer.id, 'twitter');
    const lastTweetId = lastState?.lastContentId;

    for (const tweet of tweets) {
      // 이미 처리된 트윗인지 확인 (숫자 비교)
      if (lastTweetId && this.compareTwitterIds(tweet.id, lastTweetId) <= 0) {
        continue;
      }

      const notification = this.notificationService.createTwitterNotification(
        latestStreamer.name,
        tweet.content,
        tweet.url,
        latestStreamer.profileImageUrl,
        new Date(tweet.timestamp), // Pass the original tweet timestamp
        tweet.contentHtml // Pass the HTML content
      );

      await this.notificationService.sendNotification(notification);
      console.log(`Twitter notification sent for ${streamer.name}: ${tweet.content.substring(0, 50)}...`);
    }

    // 가장 최신 트윗 ID를 데이터베이스에 저장
    if (tweets.length > 0) {
      const latestTweet = tweets[tweets.length - 1]; // 배열은 시간순으로 정렬됨
      await this.databaseManager.setMonitorState(
        streamer.id,
        'twitter',
        latestTweet.id,
        'checked'
      );
      
      // 메모리 캐시도 업데이트 (호환성 유지)
      this.lastTweetIds.set(latestStreamer.twitterUsername || streamer.twitterUsername!, latestTweet.id);
    }
  }

  private getLastCheckTime(username: string): string {
    // 마지막 체크 시간 반환 (현재는 간단히 1시간 전으로 설정)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return oneHourAgo.toISOString();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 특정 스트리머의 트윗만 조용히 체크 (baseline 설정용)
  async checkSingleStreamerTweets(streamer: StreamerData): Promise<TwitterTweet[]> {
    try {
      return await this.checkStreamerTweets(streamer);
    } catch (error) {
      console.error(`Failed to check tweets for ${streamer.name}:`, error);
      return [];
    }
  }

  // 사용자명 검증
  async validateUsername(username: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const rssUrl = await this.buildRSSUrl(username);
      const feed = await this.fetchRSSFeed(rssUrl);
      
      if (feed && feed.items && feed.items.length > 0) {
        return { valid: true };
      } else {
        return { valid: false, error: '트윗을 찾을 수 없습니다' };
      }
    } catch (error) {
      return { valid: false, error: '사용자명을 확인할 수 없습니다' };
    }
  }

  // Nitter 인스턴스 상태 확인
  async checkInstanceHealth(): Promise<void> {
    console.log('Checking Nitter instance health...');
    
    for (let i = 0; i < this.nitterInstances.length; i++) {
      try {
        const testUrl = `${this.nitterInstances[i]}/elonmusk/rss`;
        const response = await this.httpClient.get(testUrl, { timeout: 5000 });
        
        if (response.status === 200) {
          this.currentInstanceIndex = i;
          console.log(`Using healthy instance: ${this.nitterInstances[i]}`);
          return;
        }
      } catch (error) {
        console.log(`Instance ${this.nitterInstances[i]} is unhealthy`);
      }
    }
    
    console.warn('All Nitter instances appear to be unhealthy');
  }

  // Twitter ID 숫자 비교 (BigInt 사용으로 정확한 비교)
  private compareTwitterIds(id1: string, id2: string): number {
    try {
      // Twitter IDs are 64-bit integers, use BigInt for accurate comparison
      const bigInt1 = BigInt(id1);
      const bigInt2 = BigInt(id2);
      
      if (bigInt1 > bigInt2) return 1;
      if (bigInt1 < bigInt2) return -1;
      return 0;
    } catch (error) {
      console.error('Failed to compare Twitter IDs as numbers, falling back to string comparison:', error);
      // Fallback to string comparison if BigInt conversion fails
      if (id1 > id2) return 1;
      if (id1 < id2) return -1;
      return 0;
    }
  }

  // 트위터 컨텐츠에 미디어 정보 추가
  private enhanceContentWithMedia(contentHtml: string, username: string, tweetId: string): string {
    try {
      // HTML에서 이미지 링크 추출
      const imageRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
      
      let enhancedContent = contentHtml;
      
      // 이미지 태그를 찾아서 실제 이미지 URL로 변환
      enhancedContent = enhancedContent.replace(imageRegex, (match, src) => {
        // Nitter 이미지 URL을 실제 Twitter 미디어 URL로 변환 시도
        if (src.includes('pic.twitter.com') || src.includes('pbs.twimg.com')) {
          return `<img src="${src}" alt="트위터 이미지" style="max-width: 100%; height: auto;" />`;
        }
        
        // Nitter 인스턴스의 이미지를 원본으로 변환
        if (src.includes('/pic/')) {
          const mediaMatch = src.match(/\/pic\/(.+)/);
          if (mediaMatch) {
            const originalUrl = `https://pbs.twimg.com/media/${mediaMatch[1]}`;
            return `<img src="${originalUrl}" alt="트위터 이미지" style="max-width: 100%; height: auto;" />`;
          }
        }
        
        return match; // 변환 실패 시 원본 유지
      });
      
      // 링크에서 이미지 URL 추출 및 추가
      const imageLinks: string[] = [];
      enhancedContent.replace(linkRegex, (match, href, text) => {
        // pic.twitter.com 링크 감지
        if (href.includes('pic.twitter.com')) {
          imageLinks.push(`<div class="twitter-image-link">🖼️ <a href="${href}" target="_blank">이미지 보기: ${text}</a></div>`);
        }
        
        // 미디어 파일 확장자 감지
        if (/\.(jpg|jpeg|png|gif|webp|mp4|mov)(\?|$)/i.test(href)) {
          const isVideo = /\.(mp4|mov)(\?|$)/i.test(href);
          const mediaType = isVideo ? '🎥 비디오' : '🖼️ 이미지';
          imageLinks.push(`<div class="twitter-media-link">${mediaType} <a href="${href}" target="_blank">미디어 보기</a></div>`);
        }
        
        return match;
      });
      
      // 발견된 이미지 링크들을 컨텐츠 끝에 추가
      if (imageLinks.length > 0) {
        enhancedContent += '<div class="twitter-media-section">' + imageLinks.join('') + '</div>';
      }
      
      // 트위터 미디어 정보가 없는 경우 기본 미디어 링크 생성
      if (!enhancedContent.includes('twitter-image') && !enhancedContent.includes('<img')) {
        // 트윗에 첨부된 미디어가 있을 가능성을 위한 링크 추가
        const mediaUrl = `https://x.com/${username}/status/${tweetId}/photo/1`;
        enhancedContent += `<div class="twitter-potential-media">🔗 <a href="${mediaUrl}" target="_blank">트윗에서 미디어 확인하기</a></div>`;
      }
      
      return enhancedContent;
    } catch (error) {
      console.error('Failed to enhance content with media:', error);
      return contentHtml; // 오류 시 원본 반환
    }
  }

  // 정리 작업
  cleanup(): void {
    this.lastTweetIds.clear();
  }
}
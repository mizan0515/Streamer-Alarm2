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

  constructor(databaseManager: DatabaseManager, notificationService: NotificationService) {
    this.databaseManager = databaseManager;
    this.notificationService = notificationService;
    
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

  async checkAllStreamers(): Promise<TwitterTweet[]> {
    try {
      const streamers = await this.databaseManager.getStreamers();
      const activeStreamers = streamers.filter(s => s.isActive && s.twitterUsername);

      console.log(`Checking ${activeStreamers.length} Twitter streamers...`);

      const allTweets: TwitterTweet[] = [];
      
      // 순차적으로 스트리머 체크 (Nitter 인스턴스 부하 분산)
      for (const streamer of activeStreamers) {
        try {
          const tweets = await this.checkStreamerTweets(streamer);
          allTweets.push(...tweets);
          
          // 새 트윗 알림 처리
          await this.handleNewTweets(streamer, tweets);
          
          // 요청 간 딜레이 (API 부하 방지)
          await this.delay(1000);
        } catch (error) {
          console.error(`Failed to check ${streamer.name} tweets:`, error);
        }
      }

      console.log(`Twitter check completed. New tweets: ${allTweets.length}`);
      
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

      // 최신 20개 트윗 처리
      for (const item of feed.items.slice(0, 20)) {
        const tweet = this.parseRSSItem(item, streamer.twitterUsername);
        if (!tweet) continue;

        // 새 트윗인지 확인 (ID 기반)
        if (!lastTweetId || tweet.id > lastTweetId) {
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
    } catch (error) {
      console.error(`RSS fetch failed for ${url}:`, error);
      
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

      // 내용 정제
      let content = item.contentSnippet || item.title || '';
      content = this.cleanTweetContent(content);

      // 실제 X.com URL로 변환
      const realUrl = `https://x.com/${username}/status/${tweetId}`;

      return {
        id: tweetId,
        content: content,
        url: realUrl,
        timestamp: new Date(item.pubDate).toISOString()
      };
    } catch (error) {
      console.error('Failed to parse RSS item:', error);
      return null;
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

    // 스트리머별 트위터 알림 설정 확인
    if (!streamer.notifications?.twitter) return;

    // 데이터베이스에서 마지막 트윗 ID 조회
    const lastState = await this.databaseManager.getMonitorState(streamer.id, 'twitter');
    const lastTweetId = lastState?.lastContentId;

    for (const tweet of tweets) {
      // 이미 처리된 트윗인지 확인
      if (lastTweetId && tweet.id <= lastTweetId) {
        continue;
      }

      const notification = this.notificationService.createTwitterNotification(
        streamer.name,
        tweet.content,
        tweet.url,
        streamer.profileImageUrl
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
      this.lastTweetIds.set(streamer.twitterUsername!, latestTweet.id);
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

  // 정리 작업
  cleanup(): void {
    this.lastTweetIds.clear();
  }
}
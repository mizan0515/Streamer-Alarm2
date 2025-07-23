import axios, { AxiosInstance } from 'axios';

// 검색 결과 인터페이스
export interface StreamerSearchResult {
  platform: 'chzzk' | 'twitter' | 'cafe';
  name: string;
  displayName: string;
  id: string;
  profileImageUrl?: string;
  verified?: boolean;
  followerCount?: number;
  description?: string;
  url: string;
}

// 통합 검색 결과
export interface StreamerSearchResults {
  chzzk: StreamerSearchResult[];
  twitter: StreamerSearchResult[];
  cafe: StreamerSearchResult[];
}

export class StreamerSearchService {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
  }

  /**
   * 스트리머 이름으로 모든 플랫폼 통합 검색
   */
  async searchStreamer(name: string): Promise<StreamerSearchResults> {
    console.log(`🔍 Searching for streamer: ${name}`);
    
    const results: StreamerSearchResults = {
      chzzk: [],
      twitter: [],
      cafe: []
    };

    try {
      // 병렬로 모든 플랫폼 검색
      const [chzzkResults, twitterResults, cafeResults] = await Promise.allSettled([
        this.searchChzzk(name),
        this.searchTwitter(name),
        this.searchCafe(name)
      ]);

      // 성공한 결과만 반영
      if (chzzkResults.status === 'fulfilled') {
        results.chzzk = chzzkResults.value;
      } else {
        console.warn('CHZZK search failed:', chzzkResults.reason);
      }

      if (twitterResults.status === 'fulfilled') {
        results.twitter = twitterResults.value;
      } else {
        console.warn('Twitter search failed:', twitterResults.reason);
      }

      if (cafeResults.status === 'fulfilled') {
        results.cafe = cafeResults.value;
      } else {
        console.warn('Cafe search failed:', cafeResults.reason);
      }

      console.log('🎯 Search completed:', {
        chzzk: results.chzzk.length,
        twitter: results.twitter.length,
        cafe: results.cafe.length
      });

      return results;
    } catch (error) {
      console.error('❌ Streamer search failed:', error);
      return results;
    }
  }

  /**
   * CHZZK 검색
   */
  private async searchChzzk(name: string): Promise<StreamerSearchResult[]> {
    try {
      const response = await this.httpClient.get(
        `https://api.chzzk.naver.com/service/v1/search/channels`,
        {
          params: {
            keyword: name,
            size: 10,
            sortType: 'POPULAR'
          }
        }
      );

      if (response.data.code !== 200 || !response.data.content?.data) {
        return [];
      }

      return response.data.content.data.map((channel: any): StreamerSearchResult => ({
        platform: 'chzzk',
        name: channel.channel.channelName,
        displayName: channel.channel.channelName,
        id: channel.channel.channelId,
        profileImageUrl: channel.channel.channelImageUrl,
        verified: channel.channel.verifiedMark,
        followerCount: channel.channel.followerCount,
        description: channel.channel.channelDescription,
        url: `https://chzzk.naver.com/${channel.channel.channelId}`
      }));
    } catch (error) {
      console.error('CHZZK search error:', error);
      return [];
    }
  }

  /**
   * Twitter 검색 (여러 방법 시도)
   */
  private async searchTwitter(name: string): Promise<StreamerSearchResult[]> {
    // 방법 1: Nitter 인스턴스를 통한 검색
    const nitterInstances = [
      'https://xcancel.com',
      'https://nitter.poast.org',
      'https://nitter.privacyredirect.com',
      'https://nitter.tiekoetter.com',
      'https://nitter.kareem.one'
    ];

    for (const instance of nitterInstances) {
      try {
        const results = await this.searchTwitterViaUrl(name, instance);
        if (results.length > 0) {
          return results;
        }
      } catch (error) {
        console.warn(`Failed to search via ${instance}:`, error);
        continue;
      }
    }

    // 방법 2: 일반적인 패턴 기반 추천
    return this.generateTwitterSuggestions(name);
  }

  /**
   * Twitter URL 패턴 기반 검색
   */
  private async searchTwitterViaUrl(name: string, nitterInstance: string): Promise<StreamerSearchResult[]> {
    try {
      // 일반적인 VTuber 이름 패턴들
      const nameVariations = [
        name,
        name.toLowerCase(),
        name.replace(/\s+/g, '_'),
        name.replace(/\s+/g, ''),
        `${name.toLowerCase()}_vtuber`,
        `${name.toLowerCase()}ch`
      ];

      const results: StreamerSearchResult[] = [];

      for (const variation of nameVariations) {
        try {
          const response = await this.httpClient.get(
            `${nitterInstance}/${variation}`,
            { timeout: 5000 }
          );

          if (response.status === 200) {
            results.push({
              platform: 'twitter',
              name: variation,
              displayName: variation,
              id: variation,
              url: `https://twitter.com/${variation}`
            });
          }
        } catch (error) {
          // 404는 정상적인 경우 (계정이 없음)
          continue;
        }
      }

      return results;
    } catch (error) {
      return [];
    }
  }

  /**
   * Twitter 추천 계정 생성
   */
  private generateTwitterSuggestions(name: string): StreamerSearchResult[] {
    const suggestions = [
      name.replace(/\s+/g, '_'),
      name.replace(/\s+/g, '').toLowerCase(),
      `${name.toLowerCase()}_vtuber`,
      `${name.toLowerCase()}ch`,
      `${name.toLowerCase()}_ch`
    ];

    return suggestions.slice(0, 3).map(suggestion => ({
      platform: 'twitter',
      name: suggestion,
      displayName: `@${suggestion} (추천)`,
      id: suggestion,
      url: `https://twitter.com/${suggestion}`,
      description: '계정 존재 여부를 확인해주세요'
    }));
  }

  /**
   * 네이버 카페 검색 (제한적)
   */
  private async searchCafe(name: string): Promise<StreamerSearchResult[]> {
    // 네이버 카페는 로그인이 필요하고 API가 제한적이므로
    // 일반적인 VTuber 카페에서 검색하는 방식으로 구현
    
    const commonCafes = [
      { id: '30919539', name: 'VTuber 갤러리' },
      { id: '28738441', name: '버츄얼 유튜버 마이너 갤러리' }
    ];

    // 실제 구현에서는 CafeMonitor를 통해 검색
    // 현재는 더미 데이터 반환
    return [{
      platform: 'cafe',
      name: name,
      displayName: `${name} (카페 검색)`,
      id: '', // 실제 검색 후 설정
      url: `https://cafe.naver.com/ca-fe/cafes/30919539/members/search?query=${encodeURIComponent(name)}`,
      description: '카페에서 직접 확인이 필요합니다'
    }];
  }

  /**
   * URL에서 플랫폼 정보 파싱
   */
  static parseUrl(url: string): { platform: string; id: string } | null {
    try {
      const urlObj = new URL(url);
      
      // CHZZK URL 파싱
      if (urlObj.hostname.includes('chzzk.naver.com')) {
        const match = urlObj.pathname.match(/\/([a-f0-9]+)/);
        if (match) {
          return { platform: 'chzzk', id: match[1] };
        }
      }
      
      // Twitter URL 파싱
      if (urlObj.hostname.includes('twitter.com') || urlObj.hostname.includes('x.com')) {
        const match = urlObj.pathname.match(/\/([^\/\?]+)/);
        if (match && match[1] !== 'home') {
          return { platform: 'twitter', id: match[1] };
        }
      }
      
      // 네이버 카페 URL 파싱
      if (urlObj.hostname.includes('cafe.naver.com')) {
        const pathParts = urlObj.pathname.split('/');
        const memberIndex = pathParts.indexOf('members');
        if (memberIndex !== -1 && pathParts[memberIndex + 1]) {
          return { platform: 'cafe', id: pathParts[memberIndex + 1] };
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
}
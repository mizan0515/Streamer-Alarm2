import { Tray, Menu, nativeImage, shell, dialog } from 'electron';
import * as path from 'path';

export class TrayService {
  private app: any;
  private tray: Tray | null = null;
  private monitoringService: any = null;

  constructor(app: any) {
    this.app = app;
  }

  setMonitoringService(monitoringService: any): void {
    this.monitoringService = monitoringService;
  }

  createTray(): Tray {
    // 트레이 아이콘 생성
    const iconPath = this.createTrayIcon();
    this.tray = new Tray(iconPath);

    // 툴팁 설정
    this.tray.setToolTip('Streamer Alarm System');

    // 더블클릭으로 메인 윈도우 표시
    this.tray.on('double-click', () => {
      this.app.showMainWindow();
    });

    // 우클릭 시 실시간 상태 확인 후 메뉴 업데이트
    this.tray.on('right-click', async () => {
      console.log('🔄 Tray right-clicked, checking latest login status...');
      await this.updateMenuWithLatestStatus();
    });

    // 초기 컨텍스트 메뉴 설정
    this.updateContextMenu();

    return this.tray;
  }

  private createTrayIcon(): Electron.NativeImage {
    // 앱 아이콘을 시스템 트레이에 적합한 크기로 사용
    return this.createFallbackIcon();
  }

  private createFallbackIcon(): Electron.NativeImage {
    // 앱 아이콘을 시스템 트레이에 적합한 크기로 사용
    const path = require('path');
    const { app } = require('electron');
    
    // 플랫폼별 최적화된 아이콘 경로들
    const possibleIconPaths = this.getPlatformIconPaths();
    
    for (const iconPath of possibleIconPaths) {
      try {
        console.log(`🔍 Trying icon path: ${iconPath}`);
        const fs = require('fs');
        
        if (fs.existsSync(iconPath)) {
          console.log(`✅ Found icon at: ${iconPath}`);
          const icon = nativeImage.createFromPath(iconPath);
          
          if (!icon.isEmpty()) {
            // 플랫폼별 최적 크기로 리사이즈
            const iconSize = this.getOptimalIconSize();
            return icon.resize(iconSize);
          }
        } else {
          console.log(`❌ Icon not found at: ${iconPath}`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Failed to load icon from ${iconPath}:`, error.message);
        continue;
      }
    }
    
    console.warn('📁 All icon paths failed, creating pixel-based fallback icon');
    
    // Canvas 없이 안전한 fallback 시스템
    try {
      // 1차 시도: 16x16 PNG 바이너리 데이터로 간단한 아이콘 생성
      return this.createPixelIcon();
    } catch (pixelError: any) {
      console.error('Pixel icon creation failed:', pixelError.message);
      
      // 2차 시도 (최후의 수단): 단색 아이콘
      return this.createSimpleColorIcon();
    }
  }

  private createPixelIcon(): Electron.NativeImage {
    // 플랫폼별 최적 크기 사용
    const iconSize = this.getOptimalIconSize();
    const { width, height } = iconSize;
    const buffer = Buffer.alloc(width * height * 4); // RGBA
    
    // 픽셀 색상 정의 (Windows 트레이에 적합한 색상)
    const darkBlue = [64, 81, 181, 255];    // #4051b5 (Material Blue)
    const lightBlue = [144, 164, 255, 255]; // #90a4ff (Light Blue)
    const white = [255, 255, 255, 255];     // #ffffff
    const transparent = [0, 0, 0, 0];       // 투명
    
    // 스케일 팩터 계산 (16x16 기준 패턴을 다른 크기로 스케일링)
    const scale = Math.min(width / 16, height / 16);
    const scaledSize = Math.round(16 * scale);
    
    // 중앙 정렬을 위한 오프셋
    const offsetX = Math.round((width - scaledSize) / 2);
    const offsetY = Math.round((height - scaledSize) / 2);
    
    // 16x16 기준 패턴 (모니터 아이콘)
    const basePattern = [
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
      [0,0,1,2,2,2,2,2,2,2,2,2,2,1,0,0],
      [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
      [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
      [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
      [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
      [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
      [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
      [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
      [0,0,1,2,2,2,2,2,2,2,2,2,2,1,0,0],
      [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
      [0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0],
      [0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
    ];
    
    // 버퍼 초기화 (투명 배경)
    buffer.fill(0);
    
    // 패턴을 실제 크기로 그리기
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;
        
        // 스케일링된 좌표로 변환
        const baseX = Math.floor((x - offsetX) / scale);
        const baseY = Math.floor((y - offsetY) / scale);
        
        let color = transparent;
        
        if (baseX >= 0 && baseX < 16 && baseY >= 0 && baseY < 16) {
          switch (basePattern[baseY][baseX]) {
            case 1: color = white; break;      // 테두리
            case 2: color = darkBlue; break;   // 몸체
            case 3: color = lightBlue; break;  // 스크린
            default: color = transparent;      // 배경
          }
        }
        
        buffer[pixelIndex] = color[0];     // R
        buffer[pixelIndex + 1] = color[1]; // G
        buffer[pixelIndex + 2] = color[2]; // B
        buffer[pixelIndex + 3] = color[3]; // A
      }
    }
    
    console.log(`✅ Created pixel icon with size ${width}x${height}`);
    return nativeImage.createFromBuffer(buffer, { width, height });
  }


  private createSimpleColorIcon(): Electron.NativeImage {
    // 최종 fallback: 단순한 단색 아이콘
    const width = 16;
    const height = 16;
    const buffer = Buffer.alloc(width * height * 4);
    
    // 단순한 빨간색 사각형
    for (let i = 0; i < width * height; i++) {
      const index = i * 4;
      buffer[index] = 255;     // R
      buffer[index + 1] = 68;  // G
      buffer[index + 2] = 68;  // B
      buffer[index + 3] = 255; // A
    }
    
    console.log('🎨 Created simple color icon as final fallback');
    return nativeImage.createFromBuffer(buffer, { width, height });
  }

  updateContextMenu(stats?: { 
    totalStreamers?: number;
    activeStreamers?: number;
    liveStreamers?: number;
    isMonitoring?: boolean;
    needNaverLogin?: boolean;
  }): void {
    if (!this.tray) {
      console.error('❌ Tray not initialized, cannot update context menu');
      return;
    }

    console.log('🔄 Updating tray context menu with stats:', stats);
    console.log(`🔍 Login button will show: ${stats?.needNaverLogin ? '네이버 로그인' : '네이버 로그아웃'}`);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'UI 열기',
        click: () => {
          this.app.showMainWindow();
        }
      },
      { type: 'separator' },
      {
        label: stats?.needNaverLogin ? '네이버 로그인' : '네이버 로그아웃',
        click: async () => {
          await this.handleNaverAction(stats?.needNaverLogin);
        }
      },
      { type: 'separator' },
      {
        label: 'GitHub에서 열기',
        click: () => {
          shell.openExternal('https://github.com/mizan0515/Streamer-Alarm2/releases/');
        }
      },
      {
        label: '종료',
        click: () => {
          this.app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
    console.log('✅ Tray context menu updated successfully');
  }

  private showStatusDialog(stats?: {
    totalStreamers?: number;
    activeStreamers?: number;
    liveStreamers?: number;
    isMonitoring?: boolean;
  }): void {
    const { dialog } = require('electron');
    
    const statusInfo = stats ? [
      `등록된 스트리머: ${stats.totalStreamers || 0}명`,
      `활성 스트리머: ${stats.activeStreamers || 0}명`,
      `라이브 중: ${stats.liveStreamers || 0}명`,
      `모니터링 상태: ${stats.isMonitoring ? '실행 중' : '중지됨'}`,
      '',
      '웹 인터페이스: http://localhost:3000'
    ].join('\n') : '상태 정보를 불러오는 중...';

    dialog.showMessageBox(this.app.getMainWindow(), {
      type: 'info',
      title: 'Streamer Alarm System - 상태',
      message: '현재 애플리케이션 상태',
      detail: statusInfo,
      buttons: ['확인', '웹 인터페이스 열기'],
      defaultId: 0
    }).then((result: Electron.MessageBoxReturnValue) => {
      if (result.response === 1) {
        this.app.showMainWindow();
      }
    });
  }

  showContextMenu(): void {
    if (this.tray) {
      this.tray.popUpContextMenu();
    }
  }

  updateTrayIcon(isMonitoring: boolean): void {
    if (!this.tray) return;

    // 모니터링 상태에 따라 아이콘 색상 변경
    const iconPath = this.createTrayIcon();
    this.tray.setImage(iconPath);
    
    // 툴팁 업데이트
    const status = isMonitoring ? '모니터링 중' : '모니터링 중지됨';
    this.tray.setToolTip(`Streamer Alarm System - ${status}`);
  }

  updateWithSettings(settings: Record<string, any>): void {
    this.updateContextMenu({
      needNaverLogin: settings.needNaverLogin,
      isMonitoring: this.isMonitoring
    });
  }
  
  private isMonitoring: boolean = false;
  
  setMonitoringStatus(isMonitoring: boolean): void {
    this.isMonitoring = isMonitoring;
    this.updateTrayIcon(isMonitoring);
  }

  private async handleNaverAction(needLogin?: boolean): Promise<void> {
    if (!this.monitoringService) {
      console.error('MonitoringService not available');
      this.showErrorDialog('모니터링 서비스를 사용할 수 없습니다.');
      return;
    }

    const { dialog } = require('electron');
    
    try {
      if (needLogin) {
        console.log('🔐 Tray: Naver login initiated');
        
        // 로딩 다이얼로그 표시
        const loadingDialog = this.showLoadingDialog('네이버 로그인 진행 중...');
        
        const result = await this.monitoringService.initiateNaverLogin();
        
        // 로딩 다이얼로그 닫기 및 메인 윈도우 재활성화
        this.closeLoadingDialog(loadingDialog);
        
        if (result) {
          console.log('✅ Tray: Naver login successful');
          dialog.showMessageBox(this.app.getMainWindow(), {
            type: 'info',
            title: '로그인 완료',
            message: '네이버 로그인이 완료되었습니다.',
            buttons: ['확인']
          });
        } else {
          console.log('❌ Tray: Naver login failed');
          dialog.showMessageBox(this.app.getMainWindow(), {
            type: 'error',
            title: '로그인 실패',
            message: '네이버 로그인에 실패했습니다.',
            buttons: ['확인']
          });
        }
      } else {
        console.log('🚪 Tray: Naver logout initiated');
        
        // 확인 다이얼로그
        const confirmResult = await dialog.showMessageBox(this.app.getMainWindow(), {
          type: 'question',
          title: '로그아웃 확인',
          message: '네이버에서 로그아웃하시겠습니까?',
          detail: '카페 모니터링이 중단됩니다.',
          buttons: ['취소', '로그아웃'],
          defaultId: 0,
          cancelId: 0
        });
        
        if (confirmResult.response === 1) {
          // 로딩 다이얼로그 표시
          const loadingDialog = this.showLoadingDialog('네이버 로그아웃 진행 중...');
          
          const result = await this.monitoringService.initiateNaverLogout();
          
          // 로딩 다이얼로그 닫기 및 메인 윈도우 재활성화
          this.closeLoadingDialog(loadingDialog);
          
          if (result) {
            console.log('✅ Tray: Naver logout successful');
            dialog.showMessageBox(this.app.getMainWindow(), {
              type: 'info',
              title: '로그아웃 완료',
              message: '네이버 로그아웃이 완료되었습니다.',
              buttons: ['확인']
            });
          } else {
            console.log('❌ Tray: Naver logout failed');
            dialog.showMessageBox(this.app.getMainWindow(), {
              type: 'error',
              title: '로그아웃 실패',
              message: '네이버 로그아웃에 실패했습니다.',
              buttons: ['확인']
            });
          }
        }
      }
    } catch (error) {
      console.error('❌ Tray: Naver action error:', error);
      this.showErrorDialog('네이버 계정 처리 중 오류가 발생했습니다.');
    }
  }

  private showLoadingDialog(message: string): Electron.BrowserWindow | null {
    const { BrowserWindow } = require('electron');
    
    try {
      // 메인 윈도우도 비활성화
      const mainWindow = this.app.getMainWindow();
      if (mainWindow) {
        mainWindow.setEnabled(false);
        console.log('🔒 Main window disabled during tray operation');
      }
      
      const loadingWindow = new BrowserWindow({
        width: 350,
        height: 180,
        frame: false,
        alwaysOnTop: true,
        center: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        modal: true,
        parent: mainWindow || undefined,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      const loadingHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body {
              margin: 0;
              padding: 20px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              box-sizing: border-box;
            }
            .spinner {
              width: 40px;
              height: 40px;
              border: 4px solid rgba(255,255,255,0.3);
              border-top: 4px solid white;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin-bottom: 15px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            .message {
              text-align: center;
              font-size: 14px;
              font-weight: 500;
            }
          </style>
        </head>
        <body>
          <div class="spinner"></div>
          <div class="message">${message}</div>
        </body>
        </html>
      `;

      loadingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHtml)}`);
      loadingWindow.show();
      
      return loadingWindow;
    } catch (error) {
      console.error('Failed to create loading dialog:', error);
      return null;
    }
  }

  private closeLoadingDialog(loadingDialog: Electron.BrowserWindow | null): void {
    try {
      // 로딩 다이얼로그 닫기
      if (loadingDialog && !loadingDialog.isDestroyed()) {
        loadingDialog.close();
      }
      
      // 메인 윈도우 재활성화
      const mainWindow = this.app.getMainWindow();
      if (mainWindow) {
        mainWindow.setEnabled(true);
        console.log('🔓 Main window re-enabled after tray operation');
      }
    } catch (error) {
      console.error('Failed to close loading dialog:', error);
    }
  }

  private showErrorDialog(message: string): void {
    const { dialog } = require('electron');
    
    dialog.showMessageBox(this.app.getMainWindow(), {
      type: 'error',
      title: '오류',
      message: message,
      buttons: ['확인']
    });
  }

  private async updateMenuWithLatestStatus(): Promise<void> {
    try {
      if (!this.monitoringService) {
        console.error('❌ MonitoringService not available for status check');
        return;
      }

      // 최신 로그인 상태 확인 (캐시 무시)
      const needNaverLogin = await this.monitoringService.checkNaverLoginStatus();
      console.log(`🔍 Latest login status: needNaverLogin=${needNaverLogin}`);

      // 모니터링 통계도 함께 가져오기
      const stats = await this.monitoringService.getMonitoringStats();
      
      // 메뉴 업데이트
      this.updateContextMenu({
        ...stats,
        needNaverLogin: needNaverLogin
      });

      console.log('✅ Tray menu updated with latest status');
    } catch (error) {
      console.error('❌ Failed to update menu with latest status:', error);
      // 실패 시 기본 메뉴라도 표시
      this.updateContextMenu();
    }
  }

  /**
   * 플랫폼별 최적 아이콘 크기 반환
   */
  private getOptimalIconSize(): { width: number; height: number } {
    switch (process.platform) {
      case 'win32':
        return { width: 16, height: 16 };
      case 'darwin':
        // macOS Retina 지원을 위해 32x32 사용 (자동 스케일링)
        return { width: 32, height: 32 };
      case 'linux':
        // Linux 대부분 배포판에서 22x22가 표준
        return { width: 22, height: 22 };
      default:
        return { width: 16, height: 16 };
    }
  }

  /**
   * 플랫폼별 최적 아이콘 경로 반환 (프로덕션 빌드 대응)
   */
  private getPlatformIconPaths(): string[] {
    const { app } = require('electron');
    
    // 프로덕션 빌드에서 리소스 경로
    const resourcesPath = process.resourcesPath || app.getAppPath();
    
    // 개발 환경과 프로덕션 환경 구분
    const isDev = process.env.NODE_ENV === 'development';
    
    let basePaths: string[] = [];
    
    if (isDev) {
      // 개발 환경: 소스 기준 경로
      basePaths = [
        path.join(__dirname, '../../../assets'),
        path.join(__dirname, '../../../build/assets'),
        path.join(__dirname, '../../assets')
      ];
    } else {
      // 프로덕션 환경: 패키징된 앱 기준 경로
      basePaths = [
        path.join(resourcesPath, 'assets'),
        path.join(resourcesPath, 'app.asar.unpacked/assets'),
        path.join(resourcesPath, 'app/assets'),
        path.join(resourcesPath, 'app.asar/assets'),
        path.join(process.cwd(), 'assets')
      ];
    }
    
    const iconFiles = process.platform === 'win32' 
      ? ['icon.ico', 'icon.png', 'app.ico'] 
      : process.platform === 'darwin'
      ? ['icon.icns', 'icon.png', 'app.icns']
      : ['icon.png', 'icon.ico'];
    
    // 모든 경로 조합 생성
    const allPaths: string[] = [];
    for (const basePath of basePaths) {
      for (const iconFile of iconFiles) {
        allPaths.push(path.join(basePath, iconFile));
      }
    }
    
    console.log('🔍 Searching for icons in paths:', allPaths);
    return allPaths;
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
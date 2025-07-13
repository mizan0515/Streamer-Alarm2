const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Electron Builder afterPack hook
 * Playwright 브라우저 바이너리를 패키징된 앱에 포함시킵니다.
 */
exports.default = async function(context) {
  const { appOutDir, electronPlatformName } = context;
  
  if (electronPlatformName !== 'win32') {
    console.log('Skipping Playwright setup for non-Windows platform');
    return;
  }

  console.log('📦 Installing Playwright browsers for packaged app...');
  
  // 아이콘 파일들을 패키징된 앱의 resources 디렉토리에 복사
  try {
    const assetsSourceDir = path.join(__dirname, '..', 'assets');
    const assetsTargetDir = path.join(appOutDir, 'resources', 'assets');
    
    console.log('📁 Copying assets to packaged app...');
    console.log(`Source: ${assetsSourceDir}`);
    console.log(`Target: ${assetsTargetDir}`);
    
    // 대상 디렉토리 생성
    if (!fs.existsSync(assetsTargetDir)) {
      fs.mkdirSync(assetsTargetDir, { recursive: true });
    }
    
    // 에셋 파일들 복사 (아이콘 + QR 코드)
    const assetFiles = ['icon.ico', 'icon.png', 'icon.icns', 'qr.png'];
    for (const assetFile of assetFiles) {
      const sourcePath = path.join(assetsSourceDir, assetFile);
      const targetPath = path.join(assetsTargetDir, assetFile);
      
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
        console.log(`✅ Copied ${assetFile} to resources/assets/`);
        
        // QR 이미지 복사 성공 시 추가 로그
        if (assetFile === 'qr.png') {
          console.log(`📱 QR 코드 이미지가 정상적으로 패키징되었습니다.`);
        }
      } else {
        console.warn(`⚠️ ${assetFile} not found in source assets`);
        
        // QR 이미지 누락 시 경고
        if (assetFile === 'qr.png') {
          console.error(`❌ QR 코드 이미지가 누락되었습니다. 기부 위젯이 정상 동작하지 않을 수 있습니다.`);
        }
      }
    }
  } catch (error) {
    console.error('❌ Failed to copy assets:', error.message);
  }
  
  try {
    const playwrightPath = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'playwright');
    
    if (fs.existsSync(playwrightPath)) {
      // Playwright CLI를 사용하여 Chromium 설치
      const playwrightCli = path.join(playwrightPath, 'cli.js');
      
      if (fs.existsSync(playwrightCli)) {
        console.log('Installing Chromium browser...');
        execSync(`node "${playwrightCli}" install chromium`, {
          cwd: appOutDir,
          stdio: 'inherit'
        });
        console.log('✅ Playwright Chromium installed successfully');
      } else {
        console.warn('⚠️ Playwright CLI not found, browsers may need manual installation');
      }
    } else {
      console.warn('⚠️ Playwright not found in packaged app');
    }
  } catch (error) {
    console.error('❌ Failed to install Playwright browsers:', error.message);
    // 실패해도 빌드는 계속 진행
  }
};
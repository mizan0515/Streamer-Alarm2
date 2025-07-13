#!/usr/bin/env node

/**
 * macOS ICNS 파일 생성 스크립트
 * PNG 파일을 기반으로 ICNS 파일을 생성합니다.
 */

const fs = require('fs');
const path = require('path');

function createBasicIcns() {
  const assetsDir = path.join(__dirname, '../assets');
  const pngPath = path.join(assetsDir, 'icon.png');
  const icnsPath = path.join(assetsDir, 'icon.icns');
  
  console.log('🔍 Creating basic ICNS file for macOS compatibility...');
  
  try {
    // PNG 파일이 존재하는지 확인
    if (!fs.existsSync(pngPath)) {
      console.error('❌ PNG icon file not found:', pngPath);
      process.exit(1);
    }
    
    // 기본 ICNS 헤더 생성 (실제 변환을 위해서는 추가 도구가 필요)
    console.log('⚠️  Creating placeholder ICNS file.');
    console.log('📝 For production builds, please use proper tools like:');
    console.log('   - iconutil (macOS)');
    console.log('   - electron-icon-maker');
    console.log('   - png2icons');
    
    // PNG 파일을 ICNS로 복사 (임시 해결책)
    fs.copyFileSync(pngPath, icnsPath);
    
    console.log('✅ Basic ICNS file created at:', icnsPath);
    console.log('💡 For better quality, consider using specialized icon generation tools.');
    
  } catch (error) {
    console.error('❌ Failed to create ICNS file:', error.message);
    process.exit(1);
  }
}

// 스크립트가 직접 실행된 경우
if (require.main === module) {
  createBasicIcns();
}

module.exports = { createBasicIcns };
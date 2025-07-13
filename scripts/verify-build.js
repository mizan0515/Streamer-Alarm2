const fs = require('fs');
const path = require('path');

/**
 * 빌드 검증 스크립트
 * FFmpeg.dll 및 필수 의존성 파일들의 존재와 무결성을 확인
 */
function verifyBuild() {
    console.log('🔍 빌드 검증 시작...\n');
    
    // 운영체제에 따라 빌드 디렉토리 결정
    const platform = process.platform;
    let buildDirName;
    
    if (platform === 'win32') {
        buildDirName = 'win-unpacked';
    } else if (platform === 'darwin') {
        buildDirName = 'mac';
    } else {
        buildDirName = 'linux-unpacked';
    }
    
    const buildDir = path.join(__dirname, '..', 'release', buildDirName);
    console.log(`🔍 Platform: ${platform}, Build directory: ${buildDir}`);
    
    if (!fs.existsSync(buildDir)) {
        console.error('❌ 빌드 디렉토리가 존재하지 않습니다:', buildDir);
        process.exit(1);
    }
    
    const requiredFiles = [
        'Streamer Alarm System.exe',
        'ffmpeg.dll',
        'resources/app.asar',
        'resources/app.asar.unpacked',
        'locales',
        'chrome_100_percent.pak',
        'chrome_200_percent.pak',
        'icudtl.dat',
        'libEGL.dll',
        'libGLESv2.dll',
        'v8_context_snapshot.bin'
    ];
    
    let allFilesExist = true;
    
    console.log('📋 필수 파일 확인:');
    requiredFiles.forEach(file => {
        const filePath = path.join(buildDir, file);
        const exists = fs.existsSync(filePath);
        const status = exists ? '✅' : '❌';
        
        if (exists) {
            const stats = fs.statSync(filePath);
            const size = stats.isDirectory() ? '[DIR]' : `${(stats.size / 1024).toFixed(1)}KB`;
            console.log(`${status} ${file} (${size})`);
        } else {
            console.log(`${status} ${file} - 누락됨`);
            allFilesExist = false;
        }
    });
    
    console.log('\n🔍 FFmpeg.dll 상세 확인:');
    const ffmpegPath = path.join(buildDir, 'ffmpeg.dll');
    if (fs.existsSync(ffmpegPath)) {
        const stats = fs.statSync(ffmpegPath);
        console.log(`✅ FFmpeg.dll 발견`);
        console.log(`   - 크기: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
        console.log(`   - 수정 시간: ${stats.mtime.toLocaleString()}`);
        
        // 파일 시그니처 확인 (PE 헤더)
        const buffer = fs.readFileSync(ffmpegPath);
        const peSignature = buffer.slice(0, 2).toString('ascii');
        if (peSignature === 'MZ') {
            console.log(`   - 파일 타입: ✅ Windows PE 실행파일`);
        } else {
            console.log(`   - 파일 타입: ❌ 비정상적인 파일`);
            allFilesExist = false;
        }
    } else {
        console.log(`❌ FFmpeg.dll 누락됨`);
        allFilesExist = false;
    }
    
    console.log('\n🔍 네이티브 모듈 확인:');
    const nativeModules = [
        'resources/app.asar.unpacked/node_modules/better-sqlite3',
        'resources/app.asar.unpacked/node_modules/playwright'
    ];
    
    nativeModules.forEach(module => {
        const modulePath = path.join(buildDir, module);
        const exists = fs.existsSync(modulePath);
        
        const status = exists ? '✅' : '❌';
        console.log(`${status} ${path.basename(module)}`);
        
        if (!exists) {
            allFilesExist = false;
        }
    });
    
    console.log('\n📊 빌드 검증 결과:');
    if (allFilesExist) {
        console.log('✅ 모든 필수 파일이 정상적으로 존재합니다.');
        console.log('✅ 빌드가 성공적으로 완료되었습니다.');
        
        console.log('\n🚀 실행 권장사항:');
        console.log('1. 관리자 권한으로 실행하세요.');
        console.log('2. 백신 프로그램 예외 처리를 추가하세요.');
        console.log('3. Windows Defender 실시간 보호를 일시 해제하세요.');
        console.log('4. Visual C++ 2015-2022 재배포 패키지를 설치하세요.');
        
        return true;
    } else {
        console.log('❌ 일부 필수 파일이 누락되었습니다.');
        console.log('❌ 빌드를 다시 실행하세요.');
        
        console.log('\n🔧 문제 해결:');
        console.log('1. npm run build 실행');
        console.log('2. npm run dist 실행');
        console.log('3. 빌드 로그 확인');
        
        return false;
    }
}

// 스크립트 실행
if (require.main === module) {
    const success = verifyBuild();
    process.exit(success ? 0 : 1);
}

module.exports = verifyBuild;
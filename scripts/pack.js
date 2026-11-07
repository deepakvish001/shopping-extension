/*
 * Zip the extension/ folder for upload to the Chrome Web Store.
 * Output: dist/extension-v<version>.zip
 * Uses the `zip` command (macOS, Linux, WSL, Git Bash) or PowerShell on Windows.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const extDir = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'dist');
const out = path.join(outDir, `extension-v${version}.zip`);

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(out, { force: true });

if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${extDir}\\*' -DestinationPath '${out}'`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', out, '.', '-x', '.*', '*/.*'], { cwd: extDir, stdio: 'inherit' });
}
console.log(`Packed ${out}`);

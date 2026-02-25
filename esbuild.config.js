const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--prod');
const root = __dirname;
const distDir = path.resolve(root, 'dist');

const commonOptions = {
  bundle: true,
  format: 'iife',
  target: ['chrome109'],
  sourcemap: !isProd,
  minify: isProd,
  logLevel: 'info'
};

const builds = [
  {
    ...commonOptions,
    entryPoints: [path.resolve(root, 'src/popup/index.js')],
    outfile: path.resolve(distDir, 'popup.js')
  },
  {
    ...commonOptions,
    entryPoints: [path.resolve(root, 'src/content-script/index.js')],
    outfile: path.resolve(distDir, 'content-script.js')
  },
  {
    ...commonOptions,
    entryPoints: [path.resolve(root, 'src/injected.js')],
    outfile: path.resolve(distDir, 'injected.js')
  },
  {
    ...commonOptions,
    entryPoints: [path.resolve(root, 'src/background/index.js')],
    outfile: path.resolve(distDir, 'background.js')
  }
];

function copyDirectoryRecursive(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.resolve(sourceDir, entry.name);
    const targetPath = path.resolve(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyStatics() {
  fs.mkdirSync(distDir, { recursive: true });
  fs.copyFileSync(path.resolve(root, 'src/popup/popup.html'), path.resolve(distDir, 'popup.html'));
  fs.copyFileSync(path.resolve(root, 'src/popup/popup.css'), path.resolve(distDir, 'popup.css'));
  copyDirectoryRecursive(path.resolve(root, 'src/popup/assets'), path.resolve(distDir, 'popup/assets'));

  const iconSourceDir = path.resolve(root, 'icons');
  const iconDistDir = path.resolve(distDir, 'icons');
  fs.mkdirSync(iconDistDir, { recursive: true });

  for (const iconName of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) {
    fs.copyFileSync(path.resolve(iconSourceDir, iconName), path.resolve(iconDistDir, iconName));
  }

  fs.copyFileSync(path.resolve(root, 'manifest.json'), path.resolve(distDir, 'manifest.json'));
}

async function runBuild() {
  if (isWatch) {
    const contexts = await Promise.all(builds.map((build) => esbuild.context(build)));
    await Promise.all(contexts.map((context) => context.watch()));
    copyStatics();
    console.log('Watching for changes...');
    return;
  }

  await Promise.all(builds.map((build) => esbuild.build(build)));
  copyStatics();
  console.log(isProd ? 'Production build complete.' : 'Development build complete.');
}

runBuild().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});

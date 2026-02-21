const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--prod');

const commonOptions = {
    bundle: true,
    format: 'iife',
    target: ['chrome88'],
    sourcemap: !isProd,
    minify: isProd,
    logLevel: 'info',
};

// Build popup.js (output to root – the extension loads directly from root)
const buildPopup = {
    ...commonOptions,
    entryPoints: [path.resolve(__dirname, 'src/popup/index.js')],
    outfile: path.resolve(__dirname, 'popup.js'),
};

// Build content-script.js
const buildContentScript = {
    ...commonOptions,
    entryPoints: [path.resolve(__dirname, 'src/content-script/index.js')],
    outfile: path.resolve(__dirname, 'content-script.js'),
};

// Build injected.js
const buildInjected = {
    ...commonOptions,
    entryPoints: [path.resolve(__dirname, 'src/injected.js')],
    outfile: path.resolve(__dirname, 'injected.js'),
};

async function build() {
    try {
        if (isWatch) {
            // Watch mode
            const popupCtx = await esbuild.context(buildPopup);
            const contentCtx = await esbuild.context(buildContentScript);
            const injectedCtx = await esbuild.context(buildInjected);

            await Promise.all([
                popupCtx.watch(),
                contentCtx.watch(),
                injectedCtx.watch(),
            ]);

            console.log('👀 Watching for changes...');
        } else {
            // One-time build
            await Promise.all([
                esbuild.build(buildPopup),
                esbuild.build(buildContentScript),
                esbuild.build(buildInjected),
            ]);

            console.log(isProd ? '✅ Production build complete!' : '✅ Development build complete!');
        }
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

build();

/**
 * Motion Studio - Typography Bundle v1.0.0
 * Pre-caches and validates Bengali (Hind Siliguri) & English (Geist) WebFonts
 */
(function(global) {
  async function loadStudioFonts() {
    if (typeof document === 'undefined' || !('fonts' in document)) return true;
    const fontsToLoad = [
      { name: 'Hind Siliguri', url: '/fonts/hind-siliguri-regular.woff2', weight: '400' },
      { name: 'Hind Siliguri', url: '/fonts/hind-siliguri-medium.woff2', weight: '500' },
      { name: 'Geist', url: '/fonts/geist-regular.woff2', weight: '400' },
      { name: 'Geist Mono', url: '/fonts/geist-mono.woff2', weight: '400' }
    ];

    try {
      await Promise.all(fontsToLoad.map(async f => {
        const fontFace = new FontFace(f.name, `url(${f.url})`, { weight: f.weight });
        await fontFace.load();
        document.fonts.add(fontFace);
      }));
      return true;
    } catch (e) {
      console.warn('Font loading note:', e);
      return false;
    }
  }

  global.MotionFonts = {
    version: '1.0.0',
    loadStudioFonts: loadStudioFonts
  };
})(typeof self !== 'undefined' ? self : window);

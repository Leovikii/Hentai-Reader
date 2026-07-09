export const isMobileBrowser = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

export function initViewportScale() {
  
  const updateScale = () => {
    if (isMobileBrowser) {
      const screenWidth = Math.min(window.screen.width, window.screen.height);
      const layoutWidth = window.innerWidth;
      
      // Only use the enlarged mobile layout on phones (narrow screens)
      if (screenWidth < 768) {
        document.documentElement.classList.add('hr-mobile');
      } else {
        document.documentElement.classList.remove('hr-mobile');
      }
      
      let scale = 1;
      // Counteract browser viewport scaling on non-responsive pages
      if (layoutWidth > screenWidth && screenWidth > 0) {
        scale = layoutWidth / screenWidth;
      }
      
      document.documentElement.style.setProperty('--hr-scale', scale.toString());
    } else {
      document.documentElement.classList.remove('hr-mobile');
      document.documentElement.style.setProperty('--hr-scale', '1');
    }
  };

  updateScale();
  window.addEventListener('resize', updateScale);
  window.addEventListener('orientationchange', () => setTimeout(updateScale, 100));
}

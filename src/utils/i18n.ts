const isZH = navigator.language.toLowerCase().includes('zh');

export const i18n = {
  // Float Control tooltips
  readerMode: isZH ? '阅读器模式' : 'Reader Mode',
  autoPlay: isZH ? '自动翻页' : 'Auto Play',
  settings: isZH ? '设置' : 'Settings',
  backToTop: isZH ? '回到顶部' : 'Back to Top',
  play: isZH ? '播放' : 'Play',
  pause: isZH ? '暂停' : 'Pause',

  // Settings Panel
  scrollMode: isZH ? '卷轴模式' : 'Scroll Mode',
  autoEnter: isZH ? '自动进入阅读器' : 'Auto Enter Reader',
  readerWidth: isZH ? '阅读器最大宽度' : 'Reader Max Width',
  playSpeed: isZH ? '自动翻页间隔 (秒)' : 'Auto Play Interval (s)',
  thumbnailPosition: isZH ? '缩略图位置' : 'Thumbnail Position',
  posBottom: isZH ? '底部' : 'Bottom',
  posTop: isZH ? '顶部' : 'Top',
  posLeft: isZH ? '左侧' : 'Left',
  posRight: isZH ? '右侧' : 'Right',
  maxPreload: isZH ? '最大预加载数量' : 'Max Preload Count',
  close: isZH ? '关闭' : 'Close',

  // Script Menu
  toggle: isZH ? '切换: ' : 'Toggle: ',
  enabled: isZH ? '已开启' : 'Enabled',
  disabled: isZH ? '已关闭' : 'Disabled',

  // Overlay Network Status
  waitingForNetwork: isZH ? '等待网络请求...' : 'Waiting for network...',
  downloading: isZH ? '下载中...' : 'Downloading...',
  requestingNewNode: isZH ? '正在请求新节点...' : 'Requesting New Node...',
  reloading: isZH ? '重新加载中...' : 'Reloading...',
  loadFailed: isZH ? '加载失败' : 'Load Failed',
  waitImagesToLoad: isZH ? '请等待图片加载' : 'Please wait for images to load',
  resolvingImage: isZH ? '解析图片真实地址中...' : 'Resolving Image URL...',
  resolveImageFailed: isZH ? '图片解析失败' : 'Image URL fetch failed',
};

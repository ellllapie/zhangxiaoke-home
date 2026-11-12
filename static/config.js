// 小镇（static/town/）各页会读 window.NYX 拿名字；原版在 Nyx 里由它家的 config.js 提供。
window.NYX = { aiName: '章小克', meName: 'Ella' };

// 收藏墙页上原来写着他们家的地址「📍 Hesperides」，换成新家。
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.meta').forEach((e) => {
    if (e.textContent.includes('Hesperides')) e.textContent = '📍 新家';
  });
});

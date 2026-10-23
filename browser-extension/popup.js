const appUrl = 'https://kayro-ai.pages.dev/';
const titleNode = document.getElementById('page-title');
const urlNode = document.getElementById('page-url');
const messageNode = document.getElementById('message');
const openButton = document.getElementById('open');
const copyButton = document.getElementById('copy');
let pageText = '';

function report(text, isError = false) {
  messageNode.textContent = text;
  messageNode.className = 'message' + (isError ? ' error' : '');
}
function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({active: true, currentWindow: true}, tabs => {
      const tab = tabs && tabs[0];
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!tab || typeof tab.url !== 'string' || !/^https?:\/\//i.test(tab.url)) {
        return reject(new Error('این صفحه نشانی وب معمولی ندارد؛ یک سایت HTTPS یا HTTP باز کن.'));
      }
      const title = typeof tab.title === 'string' && tab.title.trim() ? tab.title.trim() : 'صفحهٔ بدون عنوان';
      resolve({title, url: tab.url});
    });
  });
}
async function copyPage() {
  openButton.disabled = true;
  copyButton.disabled = true;
  try {
    const page = await getActiveTab();
    pageText = 'لطفاً دربارهٔ این صفحه کمکم کن.\nعنوان: ' + page.title + '\nنشانی: ' + page.url;
    titleNode.textContent = page.title;
    urlNode.textContent = page.url;
    await navigator.clipboard.writeText(pageText);
    report('عنوان و نشانی کپی شد. آن‌ها را در گفتگوی KAYRO بچسبان.');
    return pageText;
  } catch (error) {
    report(error instanceof Error ? error.message : 'کپی انجام نشد.', true);
    throw error;
  } finally {
    openButton.disabled = false;
    copyButton.disabled = false;
  }
}
copyButton.addEventListener('click', () => { void copyPage().catch(() => {}); });
openButton.addEventListener('click', async () => {
  try {
    await copyPage();
    chrome.tabs.create({url: appUrl});
    report('متن کپی شد و KAYRO AI در تب جدید باز شد؛ متن را در گفتگو بچسبان.');
  } catch {}
});
getActiveTab().then(page => {
  titleNode.textContent = page.title;
  urlNode.textContent = page.url;
}).catch(error => {
  titleNode.textContent = 'صفحه‌ای در دسترس نیست';
  urlNode.textContent = '';
  report(error instanceof Error ? error.message : 'اطلاعات تب خوانده نشد.', true);
});

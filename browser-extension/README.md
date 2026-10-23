# KAYRO AI Helper (Chrome / Chromium)

This minimal Manifest V3 extension prepares the active tab's **title and URL only after you click**. It copies a short prompt to the clipboard and can open the KAYRO AI Pages app in a new tab. It never reads page HTML, cookies, passwords, or browsing history, and it makes no network request of its own.

## Install locally

1. Download this repository as a ZIP and extract it.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this `browser-extension` folder.
5. Pin the extension if you want it visible.

## Permissions

- `activeTab`: temporary access to the selected tab after the extension action is invoked.
- `clipboardWrite`: lets the popup copy the title and URL at your request.

No API key, remote script, host permission, or analytics is included. The extension prepares text only; you choose whether to paste it into a KAYRO AI conversation.

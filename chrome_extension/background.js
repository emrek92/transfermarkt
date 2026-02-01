/* background.js - Service Worker */

const API_BASE = "http://127.0.0.1:8000";

// Context Menu Oluşturma
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "search-transfermarkt",
        title: "Transfermarkt'ta '%s' Ara",
        contexts: ["selection"]
    });
});

// Yardımcı: Mesaj gönder, başarısız olursa scripti enjekte et ve tekrar dene
function sendMessageToContent(tabId, message) {
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, message).catch((err) => {
        // Hata muhtemelen content scriptin yüklü olmamasından kaynaklı
        console.log("Content Script bulunamadı, enjekte ediliyor...", err);

        chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ["styles.css"]
        }).catch(() => { }); // CSS hatası kritik değil, yutulabilir

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"]
        }, () => {
            if (chrome.runtime.lastError) {
                console.error("Script enjekte edilemedi:", chrome.runtime.lastError);
                return;
            }
            // Script yüklendi, mesajı tekrar gönder (biraz gecikme gerekebilir)
            setTimeout(() => {
                chrome.tabs.sendMessage(tabId, message).catch(e => console.error("Tekrar mesaj hatası:", e));
            }, 100);
        });
    });
}

// Context Menu Tıklama
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "search-transfermarkt" || info.menuItemId === "tm-search") {
        if (tab && tab.id) {
            // Yükleniyor mesajını güvenli gönder
            sendMessageToContent(tab.id, { type: "LOADING" });

            // Aramayı başlat
            const query = info.selectionText;
            handleSearch(query, tab.id);
        }
    }
});

// Mesajlaşma (Popup'tan gelen istekler için)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "MANUAL_SEARCH") {
        // Popup'tan geliyor, sonucu popup'a döneceğiz (sendResponse)
        handleSearch(request.query, null, sendResponse, request.isUrl); // TabId null, çünkü popup
        return true;
    }
});

async function handleSearch(query, tabId = null, sendResponse = null, isUrl = false) {
    try {
        // TabId varsa (Context Menu), loading mesajını güvenli gönder
        if (tabId && !sendResponse) {
            sendMessageToContent(tabId, { type: "LOADING" });
        }

        if (isUrl) {
            const detailRes = await fetch(`${API_BASE}/player?url=${encodeURIComponent(query)}`);
            const detailData = await detailRes.json();

            if (sendResponse) sendResponse({ type: "DETAILS", data: detailData });
            else if (tabId) sendMessageToContent(tabId, { type: "DETAILS", data: detailData });
            return;
        }

        const searchRes = await fetch(`${API_BASE}/search?name=${encodeURIComponent(query)}`);
        const searchData = await searchRes.json();
        let results = searchData.results;

        // FİLTRELEME
        // Sadece tek kelimelik aramalarda filtre uygula (Arda/Sardar vb.)
        if (results && results.length > 0) {
            const qLower = query.toLocaleLowerCase('tr').trim();
            const isMultiWord = qLower.includes(' ');

            if (!isMultiWord) {
                results = results.filter(r => {
                    const parts = r.name.toLocaleLowerCase('tr').split(/[\s-]+/);
                    return parts.some(p => p.startsWith(qLower));
                });
            }
        }

        if (!results || results.length === 0) {
            const msg = { type: "ERROR", message: "Oyuncu bulunamadı." };
            if (sendResponse) sendResponse(msg);
            else if (tabId) sendMessageToContent(tabId, msg);
            return;
        }

        // TEK SONUÇ KONTROLÜ
        // Birden fazla sonuç varsa (isim tam uysa bile) listeyi gösteriyoruz.
        if (results.length === 1) {
            const targetPlayer = results[0];
            const detailRes = await fetch(`${API_BASE}/player?url=${encodeURIComponent(targetPlayer.url)}`);
            const detailData = await detailRes.json();

            const msg = { type: "DETAILS", data: detailData };
            if (sendResponse) sendResponse(msg);
            else if (tabId) sendMessageToContent(tabId, msg);
        } else {
            // Birden fazla sonuç -> Listeyi göster
            const msg = { type: "LIST", data: results };
            if (sendResponse) sendResponse(msg);
            else if (tabId) sendMessageToContent(tabId, msg);
        }

    } catch (error) {
        console.error("API Hatası:", error);
        const msg = { type: "ERROR", message: "Hata: " + error.message };
        if (sendResponse) sendResponse(msg);
        else if (tabId) sendMessageToContent(tabId, msg);
    }
}

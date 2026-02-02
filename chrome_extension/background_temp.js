/* background.js - Service Worker */

const API_BASE = "https://transfermarkt-350k.onrender.com/";

// Context Menu Oluşturma
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "search-transfermarkt",
        title: "Transfermarkt'ta '%s' Ara",
        contexts: ["selection"]
    });
});

// Context Menu Tıklama Olayı
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "search-transfermarkt") {
        const query = info.selectionText;
        handleSearch(query, tab.id);
    }
});

// Mesajlaşma (Popup'tan gelen istekler için)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "MANUAL_SEARCH") {
        handleSearch(request.query, null, sendResponse, request.isUrl); // Popup için response dön
        return true; // Async yanıt için true dön
    }
});

async function handleSearch(query, tabId = null, sendResponse = null, isUrl = false) {
    try {
        if (isUrl) {
            // Direkt URL geldiyse (listeden seçince)
            const detailRes = await fetch(`${API_BASE}/player?url=${encodeURIComponent(query)}`);
            const detailData = await detailRes.json();
            sendResult(tabId, sendResponse, { type: "DETAILS", data: detailData });
            return;
        }

        // 1. Arama Yap
        const searchRes = await fetch(`${API_BASE}/search?name=${encodeURIComponent(query)}`);
        const searchData = await searchRes.json();
        const results = searchData.results;

        if (!results || results.length === 0) {
            sendResult(tabId, sendResponse, { type: "ERROR", message: "Oyuncu bulunamadı." });
            return;
        }

        // 2. Mantık: Tek sonuç varsa detay çek, çok sonuç varsa listele
        if (results.length === 1) {
            // Tek sonuç -> Detayları getir
            const playerUrl = results[0].url;
            const detailRes = await fetch(`${API_BASE}/player?url=${encodeURIComponent(playerUrl)}`);
            const detailData = await detailRes.json();

            sendResult(tabId, sendResponse, { type: "DETAILS", data: detailData });
        } else {
            // Çok sonuç -> Listeyi gönder
            sendResult(tabId, sendResponse, { type: "LIST", data: results });
        }

    } catch (error) {
        console.error("API Hatası:", error);
        sendResult(tabId, sendResponse, { type: "ERROR", message: "Bağlantı hatası: API çalışıyor mu?" });
    }
}

function sendResult(tabId, sendResponse, payload) {
    if (sendResponse) {
        // Popup'tan çağrıldıysa callback ile dön
        sendResponse(payload);
    } else if (tabId) {
        // Context menu'den çağrıldıysa content script'e mesaj at
        chrome.tabs.sendMessage(tabId, payload);
    }
}

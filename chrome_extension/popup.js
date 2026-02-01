document.getElementById('search-btn').addEventListener('click', performSearch);
document.getElementById('query').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
});

function performSearch() {
    const query = document.getElementById('query').value.trim();
    if (!query) return;

    const resultsDiv = document.getElementById('results');
    const loadingDiv = document.getElementById('loading');

    loadingDiv.style.display = 'block';
    resultsDiv.innerHTML = '';

    chrome.runtime.sendMessage({ type: "MANUAL_SEARCH", query: query }, (response) => {
        loadingDiv.style.display = 'none';

        if (!response || response.type === "ERROR") {
            resultsDiv.innerHTML = `<div style="color:red; text-align:center;">${response ? response.message : 'Hata oluştu'}</div>`;
            return;
        }

        if (response.type === "DETAILS") {
            const p = response.data;
            resultsDiv.innerHTML = `
        <div class="mini-profile">
          <img src="${p.image_url}" class="mini-img">
          <span class="mini-name">${p.name}</span>
          <div class="mini-club">${p.club}</div>
          <div class="mini-val">${p.market_value}</div>
          <div style="margin-top:10px; font-size:12px;">Sezon: ${p.performance.current_season.goals} Gol</div>
           <a href="${p.url}" target="_blank" style="display:block; margin-top:10px; color:#00193F; font-size:12px;">Profiline Git</a>
        </div>
      `;
        } else if (response.type === "LIST") {
            let html = '<div style="font-size:12px; font-weight:bold; margin-bottom:5px;">Sonuçlar:</div>';
            response.data.forEach(item => {
                html += `
          <div class="result" style="display:flex; align-items:center; gap:10px; cursor:pointer;" data-url="${item.url}">
            <img src="${item.image_url}" style="width:30px; height:30px; border-radius:50%;">
            <div>
              <div style="font-weight:bold; font-size:13px;">${item.name}</div>
              <div style="font-size:11px; color:#666;">${item.club}</div>
            </div>
          </div>
         `;
            });
            resultsDiv.innerHTML = html;

            // Liste elemanlarına tıklama
            resultsDiv.querySelectorAll('.result').forEach(el => {
                el.addEventListener('click', () => {
                    const url = el.getAttribute('data-url');
                    // Detay çek
                    loadingDiv.style.display = 'block';
                    resultsDiv.innerHTML = '';
                    chrome.runtime.sendMessage({ type: "MANUAL_SEARCH", query: url, isUrl: true }, (res2) => {
                        loadingDiv.style.display = 'none';
                        // Res2 DETAILS dönecek, tekrar render edelim (Recursive gibi ama basit tutuyoruz)
                        if (res2 && res2.type === "DETAILS") {
                            const p = res2.data;
                            resultsDiv.innerHTML = `
                    <div class="mini-profile">
                      <img src="${p.image_url}" class="mini-img">
                      <span class="mini-name">${p.name}</span>
                      <div class="mini-club">${p.club}</div>
                      <div class="mini-val">${p.market_value}</div>
                    </div>
                  `;
                        }
                    });
                });
            });
        }
    });
}

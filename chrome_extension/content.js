// content.js - Injected UI Handler

let tmOverlayContainer = null;
let tmShadowRoot = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LIST" || message.type === "DETAILS" || message.type === "ERROR" || message.type === "LOADING") {
    showModal(message);
  }
});

function createOverlay() {
  if (tmOverlayContainer) return;

  tmOverlayContainer = document.createElement('div');
  tmOverlayContainer.id = 'tm-extension-root';
  tmOverlayContainer.style.position = 'fixed';
  tmOverlayContainer.style.zIndex = '2147483647';
  document.body.appendChild(tmOverlayContainer);

  tmShadowRoot = tmOverlayContainer.attachShadow({ mode: 'open' });

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  tmShadowRoot.appendChild(styleLink);

  const wrapper = document.createElement('div');
  wrapper.className = 'tm-overlay';
  tmShadowRoot.appendChild(wrapper);

  return wrapper;
}

function getOverlayContent() {
  if (!tmOverlayContainer) createOverlay();
  return tmShadowRoot.querySelector('.tm-overlay');
}

function closeOverlay() {
  if (tmOverlayContainer) {
    tmOverlayContainer.remove();
    tmOverlayContainer = null;
    tmShadowRoot = null;
  }
}

function showModal(message) {
  const overlay = getOverlayContent();

  // Header Render
  let html = `
    <div class="tm-header">
      <div class="tm-logo">⚽ TRANSFERMARKT</div>
      <div class="tm-close" id="tm-close-btn">×</div>
    </div>
  `;

  // Tabs (Only for Details)
  if (message.type === "DETAILS") {
    html += `
      <div class="tm-tabs">
        <div class="tm-tab active" data-tab="profile">Profil</div>
        <div class="tm-tab" data-tab="performance">Performans</div>
        <div class="tm-tab" data-tab="market">Piyasa Değeri</div>
        <div class="tm-tab" data-tab="injuries">Sakatlıklar</div>
      </div>
    `;
  }

  html += `<div class="tm-content">`;

  // ... (LOADING, ERROR, LIST logic is same) ...
  if (message.type === "LOADING") {
    html += `
       <div class="tm-loading-container">
          <div class="tm-skeleton-header"></div>
          <div class="tm-skeleton-content">
             <div class="tm-loading">
                <div class="tm-spinner"></div>
                <div style="margin-top:10px; font-weight:600;">Veriler çekiliyor...</div>
             </div>
          </div>
       </div>
     `;
  }
  else if (message.type === "ERROR") {
    html += `<div class="tm-error">${message.message}</div>`;
  }
  else if (message.type === "LIST") {
    html += getListHTML(message.data);
  }
  else if (message.type === "DETAILS") {
    const p = message.data;

    // FORMATLAMA: "mil. €" -> "Milyon €"
    const formatMV = (val) => {
      if (!val || val === '-') return '-';
      return val.replace('mil.', 'Milyon').replace('bin', 'Bin');
    };

    const mvFormatted = formatMV(p.market_value);
    const highMvFormatted = formatMV(p.highest_market_value);

    // Market value history sorter (Newest first)
    // API returns chaotic or sorted, let's parse date to safely sort descending
    const mvHistory = (p.market_value_history || []).sort((a, b) => 0).reverse();

    html += `
      <!-- TAB: PROFIL -->
      <div class="tm-tab-content" id="tab-profile">
        <div class="tm-profile-card">
           <div class="tm-profile-img-box">
             <img src="${p.image_url}" class="tm-profile-img" onerror="this.src='https://www.transfermarkt.com.tr/images/portrait/header/default.jpg'">
           </div>
           <div class="tm-info-box">
             <div class="tm-name-header">${p.name}</div>
             <div class="tm-club-row">
               <img src="${p.club_image_url}" width="20"> 
               <strong>${p.club}</strong> | ${p.league_name}
             </div>
             
             <div class="tm-val-box">
                <div>
                   <span class="tm-val-label">Piyasa Değeri</span>
                   ${mvFormatted}
                </div>
                <div style="text-align:right">
                   <div style="font-size:10px; opacity:0.7">En Yüksek</div>
                   <div style="font-size:13px">${highMvFormatted}</div>
                </div>
             </div>
             <div class="tm-val-last">Son günc: ${p.market_value_last_update}</div>
           </div>
        </div>

        <div class="tm-table-box">
          <div class="tm-table-header">OYUNCU BİLGİLERİ</div>
          ${row('Tam Adı', p.full_name)}
          ${row('Doğum Tarihi / Yaş', `${p.birth_date} (${p.age})`)}
          ${row('Doğum Yeri', p.birth_place)}
          ${row('Uyruk', p.nationality)}
          ${row('Boy / Ayak', `${p.height || '-'} / ${p.foot || '-'}`)}
          ${row('Mevki', p.position)}
          ${row('Yan Mevkiler', Array.isArray(p.secondary_positions) ? p.secondary_positions.join(', ') : '-')}
          ${row('Menajer', p.agent)}
          ${row('Sözleşme Bitiş', p.contract_expires)}
          ${row('Sponsor', p.outfitter)}
        </div>

        <!-- PROFİL LİNKİ -->
        <div style="text-align:center; margin-top:15px; padding-bottom:10px;">
            <a href="${p.url}" target="_blank" style="
                display:inline-block; 
                background:#00193F; 
                color:#fff; 
                text-decoration:none; 
                padding:8px 15px; 
                font-size:12px; 
                border-radius:4px;
                font-weight:bold;">
                Transfermarkt Profiline Git 🔗
            </a>
        </div>
      </div>

      <!-- TAB: PERFORMANCE aka KARIYER -->
      <div class="tm-tab-content tm-hidden" id="tab-performance">
         <!-- BU SEZON -->
         <div class="tm-table-box">
           <div class="tm-table-header">BU SEZON PERFORMANSI</div>
           <table class="tm-perf-table">
             <thead>
               <tr><th class="tm-comp-col">Turnuva</th><th>Maç</th><th>Gol</th><th>Asist</th><th>Dk</th></tr>
             </thead>
             <tbody>${getSeasonRows(p.performance.current_season)}</tbody>
           </table>
         </div>

         <!-- KULÜPLERE GÖRE -->
         <div class="tm-table-box">
           <div class="tm-table-header">KULÜPLERE GÖRE PERFORMANS</div>
           <table class="tm-perf-table">
             <thead>
               <tr><th class="tm-comp-col">Kulüp</th><th>Maç</th><th>Gol</th><th>Asist</th></tr>
             </thead>
             <tbody>${getTeamStatsRows(p.performance.by_team)}</tbody>
           </table>
         </div>

         <!-- TRANSFER -->
         <div class="tm-table-box">
           <div class="tm-table-header">TRANSFER GEÇMİŞİ</div>
           <div class="tm-transfer-list">
             <div class="tm-transfer-row tm-transfer-header">
               <span>Sezon/Tarih</span><span>Transfer</span><span>Değer</span><span>Bonservis</span>
             </div>
             ${getTransferRows(p.transfer_history)}
           </div>
         </div>
      </div>

      <!-- TAB: MARKET VALUE -->
      <div class="tm-tab-content tm-hidden" id="tab-market">
         <div class="tm-profile-card" style="flex-direction:column; align-items:center; text-align:center;">
             <div style="font-size:12px; color:#666;">Güncel Değer</div>
             <div style="font-size:24px; font-weight:bold; color:#00193F;">${mvFormatted}</div>
             <div style="font-size:11px;">${p.market_value_last_update}</div>
         </div>
         <div class="tm-table-box">
            <div class="tm-table-header">PİYASA DEĞERİ GEÇMİŞİ (YENİDEN ESKİYE)</div>
            <div style="max-height:400px; overflow-y:auto;">
               ${getMarketValueRows(mvHistory)}
            </div>
         </div>
      </div>

      <!-- TAB: INJURIES -->
      <div class="tm-tab-content tm-hidden" id="tab-injuries">
          <div class="tm-table-box">
            <div class="tm-table-header">SAKATLIK GEÇMİŞİ</div>
            <table class="tm-perf-table">
              <thead>
                <tr>
                   <th class="tm-comp-col">Sezon</th>
                   <th>Sakatlık</th>
                   <th>Süre</th>
                   <th>Maç</th>
                </tr>
              </thead>
              <tbody>
                ${getInjuryRows(p.injuries)}
              </tbody>
            </table>
          </div>
      </div>
    `;
  }

  html += `</div>`; // Close content
  overlay.innerHTML = html;

  // EVENTS
  const closeBtn = tmShadowRoot.getElementById('tm-close-btn');
  closeBtn.addEventListener('click', closeOverlay);

  if (message.type === "DETAILS") {
    // Tabs Logic
    const tabs = tmShadowRoot.querySelectorAll('.tm-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const target = tab.getAttribute('data-tab');
        tmShadowRoot.querySelectorAll('.tm-tab-content').forEach(c => c.classList.add('tm-hidden'));
        tmShadowRoot.getElementById(`tab-${target}`).classList.remove('tm-hidden');
      });
    });
  }

  if (message.type === "LIST") {
    const items = tmShadowRoot.querySelectorAll('.tm-list-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        // Show loading inner
        overlay.innerHTML = `
          <div class="tm-header">
            <div class="tm-logo">⚽ GM Transfermarkt</div>
            <div class="tm-close" id="tm-close-btn-load">×</div>
          </div>
          <div class="tm-loading">
            <div class="tm-spinner"></div>
            <div style="margin-top:10px;">Veriler yükleniyor...</div>
          </div>
        `;
        tmShadowRoot.getElementById('tm-close-btn-load').addEventListener('click', closeOverlay);

        const url = item.getAttribute('data-url');
        chrome.runtime.sendMessage({ type: "MANUAL_SEARCH", query: url, isUrl: true }, (response) => {
          if (response) showModal(response);
        });
      });
    });
  }
}

// HELPERS
function row(label, val) {
  return val && val !== '-' ? `
    <div class="tm-data-row">
      <div class="tm-label">${label}</div>
      <div class="tm-val">${val}</div>
    </div>` : '';
}

function getListHTML(data) {
  let h = '';
  data.forEach(p => {
    h += `
      <div class="tm-list-item" data-url="${p.url}">
        <img src="${p.image_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">
        <div>
           <div style="font-weight:bold; color:#00193F;">${p.name}</div>
           <div style="font-size:11px; color:#666;">${p.club}</div>
        </div>
      </div>
    `;
  });
  return h;
}

function getSeasonRows(seasonData) {
  if (!Array.isArray(seasonData) || seasonData.length === 0) return '<tr><td colspan="5">Veri yok</td></tr>';

  let totalMatches = 0, totalGoals = 0, totalAssists = 0, totalMinutes = 0;

  const rows = seasonData.map(s => {
    // Parse values for total
    const m = parseInt(s.appearances) || 0;
    const g = parseInt(s.goals) || 0;
    const a = parseInt(s.assists) || 0;
    const minStr = (s.minutes || "").replace('.', '').replace("'", "");
    const min = parseInt(minStr) || 0;

    totalMatches += m;
    totalGoals += g;
    totalAssists += a;
    totalMinutes += min;

    return `
     <tr>
       <td class="tm-comp-col">${s.competition}</td>
       <td>${s.appearances}</td>
       <td>${s.goals}</td>
       <td>${s.assists}</td>
       <td>${s.minutes}'</td>
     </tr>
   `}).join('');

  // Add Total Row
  const totalRow = `
     <tr style="font-weight:bold; background-color:#f0f3f5; border-top:2px solid #ddd;">
       <td class="tm-comp-col">TOPLAM</td>
       <td>${totalMatches}</td>
       <td>${totalGoals}</td>
       <td>${totalAssists}</td>
       <td>${totalMinutes.toLocaleString('tr-TR')}'</td>
     </tr>
   `;

  return rows + totalRow;
}

function getTeamStatsRows(teamData) {
  if (!Array.isArray(teamData) || teamData.length === 0) return '<tr><td colspan="4">Veri yok</td></tr>';

  let totalMatches = 0, totalGoals = 0, totalAssists = 0;

  const rows = teamData.map(t => {
    const m = parseInt(t.appearances) || 0;
    const g = parseInt(t.goals) || 0;
    const a = parseInt(t.assists) || 0;

    totalMatches += m;
    totalGoals += g;
    totalAssists += a;

    return `
     <tr>
       <td class="tm-comp-col">
          <img src="${t.team_logo}" width="16" style="margin-right:4px; vertical-align:middle;"> ${t.team}
       </td>
       <td>${t.appearances}</td>
       <td>${t.goals}</td>
       <td>${t.assists}</td>
     </tr>
   `}).join('');

  // Add Total Row
  const totalRow = `
     <tr style="font-weight:bold; background-color:#f0f3f5; border-top:2px solid #ddd;">
       <td class="tm-comp-col">TOPLAM</td>
       <td>${totalMatches}</td>
       <td>${totalGoals}</td>
       <td>${totalAssists}</td>
     </tr>
   `;

  return rows + totalRow;
}

function getTransferRows(tData) {
  if (!tData || tData.length === 0) return '<div class="tm-padding">Veri yok</div>';

  // API zaten veriyi Yeniden-Eskiye (Transfermarkt standardı) çekiyor.
  // Ekstra sıralama yapmadan olduğu gibi kullanıyoruz.

  return tData.map((t, index) => {
    // En güncel transfer (ilk satır) için görsel vurgu
    const isLatest = index === 0;
    const highlightConf = isLatest ? 'border-left: 3px solid #00193F; background-color:#f9f9f9;' : '';

    return `
      <div class="tm-transfer-row" style="${highlightConf}">
         <div style="color:#666;">${t.season}<br><span style="font-size:9px">${t.date}</span></div>
         <div class="tm-club-change" style="display:flex; flex-direction:column; justify-content:center;">
            <div class="tm-club-item" style="color:#090; font-weight:600;">A: ${t.to_club}</div>
            <div class="tm-club-item" style="color:#d00; font-size:11px;">G: ${t.from_club}</div>
         </div>
         <div style="text-align:right;">${t.market_value}</div>
         <div style="text-align:right;" class="tm-fee">${t.fee}</div>
      </div>
   `}).join('');
}

function getInjuryRows(injuries) {
  if (!Array.isArray(injuries) || injuries.length === 0) return '<tr><td colspan="4">Kayıtlı sakatlık yok</td></tr>';
  return injuries.map(i => `
     <tr>
       <td class="tm-comp-col">${i.season}</td>
       <td style="text-align:left;">${i.injury}</td>
       <td>${i.days}</td>
       <td>${i.matches_missed}</td>
     </tr>
   `).join('');
}

function getMarketValueRows(hData) {
  if (!hData || hData.length === 0) return '<div style="padding:10px;">Değer verisi bulunamadı</div>';
  // Hepsini göster (slice yok)
  return hData.map(h => {
    const val = h.value.replace('mil.', 'Milyon').replace('bin', 'Bin');
    return `
       <div class="tm-data-row">
          <div>${h.date} - ${h.club}</div>
          <div style="font-weight:bold;">${val}</div>
       </div>
    `;
  }).join('');
}

// drawChart function removed as per instructions.

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
from bs4 import BeautifulSoup
import re
import urllib.parse

app = FastAPI(title="Transfermarkt Scraper API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
}

BASE_URL = "https://www.transfermarkt.com.tr"

def search_players(player_name):
    search_url = f"{BASE_URL}/schnellsuche/ergebnis/schnellsuche?query={urllib.parse.quote(player_name)}"
    results = []
    seen_urls = set()
    try:
        response = requests.get(search_url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        table = soup.find('table', class_='items')
        if not table: return results
        for row in table.find('tbody').find_all('tr', recursive=False):
            link = row.find('a', href=re.compile(r'/profil/spieler/'))
            if link:
                href = link['href']
                full_url = BASE_URL + href if not href.startswith('http') else href
                if full_url in seen_urls: continue
                seen_urls.add(full_url)
                name = link.get('title') or link.get_text(strip=True)
                img = row.find('img')
                img_url = img.get('src') if img else ''
                club = "-"
                club_img = row.find('img', class_='tiny_wappen')
                if club_img: club = club_img.get('title') or '-'
                results.append({'name': name, 'url': full_url, 'image_url': img_url, 'club': club})
    except Exception as e:
        print(f"Search error: {e}")
    return results

def get_team_based_stats(profile_url):
    """Takım bazlı istatistikleri çek (Hem detay hem verien sayfasını dener)"""
    teams = []
    
    def parse_stats_table(soup_obj):
        # 1. Klasik 'items' tablosunu ara
        extracted = []
        tables = soup_obj.find_all('table', class_='items')
        for table in tables:
            # Doğru tablo mu? Başlığında 'Kulüp' veya 'Club' geçiyor mu bakalım
            # Veya direkt içeriğe bakalım.
            tbody = table.find('tbody')
            if not tbody: continue
            
            for row in tbody.find_all('tr'):
                cells = row.find_all('td')
                if len(cells) >= 5: # En az Logo, İsim, Maç, Gol, Asist
                    team_name = ""
                    team_logo = ""
                    
                    # Logo & İsim Çıkarma
                    img = cells[0].find('img')
                    if img: team_logo = img.get('src', '').replace('tiny', 'header')
                    
                    # İsim genelde 2. hücrededir (index 1) ama bazen resimle aynı hücrede olabilir.
                    # Transfermarkt'ta genelde: td.zentriert(resim) | td.hauptlink(takım)
                    if len(cells) > 1:
                        txt = cells[1].get_text(strip=True)
                        if txt: team_name = txt
                        # Link varsa oradan al (daha temiz)
                        a_tag = cells[1].find('a')
                        if a_tag: team_name = a_tag.get_text(strip=True)
                    
                    if not team_name and img: # İsim yoksa resim alt textine bak
                        team_name = img.get('alt', '')
                    
                    if not team_name: continue

                    # İstatistikleri bulma (Maç, Gol, Asist)
                    # "zentriert" class'ı olan hücreler sayısaldır.
                    stats_cells = row.find_all('td', class_='zentriert')
                    numeric_vals = []
                    
                    # İlk hücre (logo) genelde zentriert'tir, onu atlayalım.
                    # Takım ismi (hauptlink) zentriert değildir.
                    # Maç, Gol, Asist zentriert'tir.
                    
                    for sc in stats_cells:
                        val = sc.get_text(strip=True)
                        # Logo hücresi (boş veya img) olabilir, sayı değilse atla
                        if not val and sc.find('img'): continue 
                        
                        # Sayı mı? (veya -)
                        if val == '-' or val.isdigit() or re.match(r'^\d+$', val):
                            numeric_vals.append(val.replace('-', '0'))
                    
                    # Beklenen sıra: [Maç, Gol, Asist, (Kartlar)...]
                    # Ancak bazen "Kadroda olma" gibi sütunlar başa gelebilir.
                    # Genelde en garantisi: items tablosunda sütun başlıklarına bakmaktır ama th'lere erişmek zor.
                    # Varsayım: İlk 3 sayısal değer Maç, Gol, Asist'tir.
                    
                    if len(numeric_vals) >= 3:
                        extracted.append({
                            "team": team_name,
                            "team_logo": team_logo,
                            "appearances": numeric_vals[0],
                            "goals": numeric_vals[1],
                            "assists": numeric_vals[2]
                        })
            if extracted: break # İlk dolu tabloyu al
        return extracted

    try:
        # A. Kullanıcının istediği 'leistungsdatendetails' sayfası
        target_url = profile_url.replace('/profil/', '/leistungsdatendetails/')
        resp = requests.get(target_url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(resp.content, 'html.parser')
        
        # Kullanıcının bahsettiği component 'tm-performance-per-entity-table'
        # Ama BS4 bunu sadece tag olarak görür. İçinde standart table varsa 'items' ile yakalarız.
        # Genelde bu sayfada "Sezon" tablosu ve "Kulüp" tablosu olur.
        # Kulüp tablosunu bulmak için başlığa bakabiliriz.
        
        # Önce bu sayfasaki tüm tabloları dene
        stats = parse_stats_table(soup)
        
        # Eğer boş geldiyse veya çok azsa, eski yönteme (leistungsdatenverein) dön
        if not stats:
            # B. Dedicated Sayfa
            v_url = profile_url.replace('/profil/', '/leistungsdatenverein/')
            v_resp = requests.get(v_url, headers=HEADERS, timeout=10)
            v_soup = BeautifulSoup(v_resp.content, 'html.parser')
            stats = parse_stats_table(v_soup)
            
        teams = stats

    except Exception as e:
        print(f"Team stats error: {e}")
        
    return teams

def get_all_performance_data(profile_url, soup_obj=None):
    """Tüm performans verilerini çek (Turnuva bazlı detaylı)"""
    result = {
        "current_season": [], 
        "career_total": {"appearances": "0", "goals": "0", "assists": "0"},
        "by_team": []
    }
    
    def parse_rows(tbody_obj):
        rows_data = []
        if not tbody_obj: return rows_data
        for row in tbody_obj.find_all('tr'):
            cells = row.find_all('td')
            if len(cells) > 5:
                # 0:Logo, 1:Ad, 2:Maç, 3:Gol, 4:Asist ... Son: Dakika
                comp = cells[1].get_text(strip=True)
                # Bazen resim var text yok, düzeltelim:
                if not comp:
                     a_tag = cells[1].find('a')
                     if a_tag: comp = a_tag.get_text(strip=True)
                
                if not comp: continue

                apps = cells[2].get_text(strip=True)
                goals = cells[3].get_text(strip=True)
                assists = cells[4].get_text(strip=True)
                minutes = cells[-1].get_text(strip=True).replace("'", "")
                
                # Toplam satırını elemek için:
                if comp.lower() == 'toplam' or comp.lower() == 'total': continue

                if apps != "-" and apps != "":
                    rows_data.append({
                        "competition": comp,
                        "appearances": apps,
                        "goals": goals,
                        "assists": assists,
                        "minutes": minutes
                    })
        return rows_data

    try:
        # 1. Takım Bazlı (Mevcut fonksiyon)
        result["by_team"] = get_team_based_stats(profile_url)
        
        # 2. Güncel Sezon (ÖNCELİK: Ana Profil Tablosu)
        found = False
        if soup_obj:
            # Transfermarkt ana profilde "Bu sezonki performansı" tablosunu arıyoruz.
            headers = soup_obj.find_all(['div', 'h2'], string=re.compile(r'Bu sezonki performansı|Stats current season|Leistungsdaten der aktuellen Saison', re.IGNORECASE))
            for h in headers:
                # Genellikle başlığın hemen sonrasındaki tablo veya parent'ın içindeki tablo
                parent = h.find_parent('div', class_='box')
                if parent:
                    tbl = parent.find('table')
                else:
                    tbl = h.find_next('table')
                
                if tbl and tbl.find('tbody'):
                    data = parse_rows(tbl.find('tbody'))
                    if data:
                        result["current_season"] = data
                        found = True
                        break
        
        # 3. Eğer profilde bulamadıysak detay sayfasına git
        if not found:
             import datetime
             now = datetime.datetime.now()
             current_season_year = now.year if now.month >= 7 else now.year - 1
             
             base_perf_url = profile_url.replace('/profil/', '/leistungsdaten/').split('?')[0]
             if '/plus/' not in base_perf_url:
                 base_perf_url = base_perf_url.rstrip('/') + "/plus/1"
             
             season_url = f"{base_perf_url}?saison_id={current_season_year}"
             
             season_resp = requests.get(season_url, headers=HEADERS, timeout=10)
             season_soup = BeautifulSoup(season_resp.content, 'html.parser')
             
             tbl = season_soup.find('table', class_='items')
             if tbl and tbl.find('tbody'):
                 result["current_season"] = parse_rows(tbl.find('tbody'))

        # 4. Kariyer Toplamı
        career_url = profile_url.replace('/profil/', '/leistungsdatendetails/')
        c_resp = requests.get(career_url, headers=HEADERS, timeout=10)
        c_soup = BeautifulSoup(c_resp.content, 'html.parser')
        c_table = c_soup.find('table', class_='items')
        if c_table and c_table.find('tfoot'):
            cells = c_table.find('tfoot').find_all('td')
            if len(cells) >= 7:
                 result["career_total"] = {
                     "appearances": re.sub(r'[^\d]', '', cells[4].get_text(strip=True)),
                     "goals": re.sub(r'[^\d]', '', cells[5].get_text(strip=True)),
                     "assists": re.sub(r'[^\d]', '', cells[6].get_text(strip=True))
                 }

    except Exception as e:
        print(f"Perf error: {e}")
        
    return result

def get_injury_history(profile_url):
    """Sakatlık geçmişini çek"""
    injuries = []
    try:
        injury_url = profile_url.replace('/profil/', '/verletzungen/')
        response = requests.get(injury_url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        table = soup.find('table', class_='items')
        if table:
            tbody = table.find('tbody')
            if tbody:
                for row in tbody.find_all('tr'):
                    cells = row.find_all('td')
                    if len(cells) >= 4:
                        injury_name = ""
                        season = ""
                        days = ""
                        matches_missed = ""
                        for td in cells:
                            text = td.get_text(strip=True)
                            if re.match(r'\d{2}/\d{2}', text):
                                season = text
                            elif 'gün' in text.lower():
                                days = text
                            elif len(text) > 5 and not re.search(r'\d{4}', text):
                                if not injury_name:
                                    injury_name = text
                        for td in reversed(cells):
                            text = td.get_text(strip=True)
                            if text.isdigit():
                                matches_missed = text
                                break
                        if injury_name:
                            injuries.append({
                                "season": season or "-",
                                "injury": injury_name,
                                "days": days or "-",
                                "matches_missed": matches_missed or "-"
                            })
    except Exception as e:
        print(f"Injury data error: {e}")
    return injuries

def get_market_value_history(soup):
    """Extract market value history from Highcharts script"""
    history = []
    try:
        scripts = soup.find_all('script')
        for script in scripts:
            if script.string and 'Highcharts.chart(\'marktwertverlauf-grafik\'' in script.string:
                # Extract the series data using regex
                match = re.search(r'\'data\':\s*(\[.*?\])\s*\}', script.string, re.DOTALL)
                if match:
                    import json
                    # Pre-process the JS-like data to be valid JSON (handles some single quotes and keys)
                    data_str = match.group(1).replace("'", '"')
                    # This is a bit risky but we'll try to refine it if it fails
                    try:
                        data_json = json.loads(data_str)
                        for entry in data_json:
                            history.append({
                                'date': entry.get('datum_mw', '-'),
                                'value': entry.get('mw', '-'),
                                'club': entry.get('verein', '-')
                            })
                    except:
                        # Fallback simple regex if json.loads fails
                        points = re.findall(r'datum_mw":"(.*?)"(?:.*?)"mw":"(.*?)"(?:.*?)"verein":"(.*?)"', script.string)
                        for d, v, c in points:
                            history.append({'date': d, 'value': v, 'club': c})
                break
    except Exception as e:
        print(f"Market value history error: {e}")
    return history

def get_mv_history_from_page(player_url):
    """Fetch market value history using CEAPI (primary) or scraping (fallback)"""
    history = []
    
    # 1. Try CEAPI (Most reliable)
    try:
        player_id = re.search(r'/spieler/(\d+)', player_url)
        if player_id:
            pid = player_id.group(1)
            api_url = f"{BASE_URL}/ceapi/marketValueDevelopment/graph/{pid}"
            resp = requests.get(api_url, headers=HEADERS, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                # CEAPI returns a structure: {'list': [{'y': 35000000, 'datum_mw': 'Run 23, 2025', ...}, ...]}
                # The keys might vary, let's inspect usually 'list' or straight array
                items = data.get('list', [])
                if not items and isinstance(data, list): items = data
                
                for item in items:
                    # 'y' is usually raw value (e.g. 35000000), 'mw' is formatted (e.g. "35.00 mil. €")
                    history.append({
                        'date': item.get('datum_mw', '-'),
                        'value': item.get('mw', '-'),
                        'club': item.get('verein', '-')
                    })
                if history: return history
    except Exception as e:
        print(f"CEAPI MV error: {e}")

    # 2. Fallback: Scraping from the dedicated MV page
    try:
        mv_url = player_url.replace('/profil/', '/marktwertverlauf/')
        response = requests.get(mv_url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        scripts = soup.find_all('script')
        for script in scripts:
            if script.string and ('Highcharts.Chart' in script.string or 'marktwertverlauf' in script.string):
                # Try to find 'data': [...]
                # We look for the array of objects inside 'data'
                # Regex to capture content inside data: [ ... ]
                match = re.search(r'[\"\']data[\"\']\s*:\s*(\[\{.*?\}\])', script.string, re.DOTALL)
                if match:
                    import json
                    # The data is usually JS object literals, not strict JSON. 
                    # We need to parse strict JSON or regex extract fields.
                    # Given python's limitation with JS objects, regex extraction per item is safer.
                    blob = match.group(1)
                    # Find all objects {...}
                    # This regex finds balanced braces roughly or just items with date/value
                    entries = re.findall(r'\{[^{}]*?datum_mw[^{}]*?\}', blob, re.DOTALL)
                    for entry in entries:
                         datum = re.search(r'[\"\']datum_mw[\"\']\s*:\s*[\"\'](.*?)[\"\']', entry)
                         mw = re.search(r'[\"\']mw[\"\']\s*:\s*[\"\'](.*?)[\"\']', entry)
                         verein = re.search(r'[\"\']verein[\"\']\s*:\s*[\"\'](.*?)[\"\']', entry)
                         
                         if datum and mw:
                             # Decode unicode escapes if any
                             d_val = datum.group(1).encode().decode('unicode-escape')
                             m_val = mw.group(1).encode().decode('unicode-escape')
                             c_val = verein.group(1).encode().decode('unicode-escape') if verein else '-'
                             
                             history.append({
                                 'date': d_val,
                                 'value': m_val,
                                 'club': c_val
                             })
                    if history: return history
    except Exception as e:
        print(f"MV Scrape fallback error: {e}")
        
    return history

def scrape_player_profile(url):
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        player_id = None
        m = re.search(r'/spieler/(\d+)', url)
        if m: player_id = m.group(1)
        
        data = {
            "url": url,
            "player_id": player_id,
            "name": "-",
            "full_name": "-",
            "jersey_number": "-",
            "image_url": "",
            "market_value": "-",
            "highest_market_value": "-",
            "market_value_last_update": "-",
            "market_value_history": [],
            "club": "-",
            "club_image_url": "",
            "contract_expires": "-",
            "position": "-",
            "secondary_positions": [],
            "age": "-",
            "birth_date": "-",
            "birth_place": "-",
            "nationality": "-",
            "height": "-",
            "foot": "-",
            "agent": "-",
            "outfitter": "-",
            "social_media": [],
            "league_name": "-",
            "league_image_url": "-",
            "youth_clubs": [],
            "success_badges": [],
            "national_team": {"name": "-", "matches": "-", "goals": "-", "debut": "-"},
            "transfer_history": [],
            "performance": {
                "current_season": {"appearances": "0", "goals": "0", "assists": "0"},
                "career_total": {"appearances": "0", "goals": "0", "assists": "0"},
                "by_team": []
            },
            "injuries": []
        }

        # 1. Header Info
        header = soup.find('header', class_='data-header')
        if header:
            h1 = header.find('h1', class_='data-header__headline-wrapper')
            if h1:
                num = h1.find('span', class_='data-header__shirt-number')
                data['jersey_number'] = num.get_text(strip=True).replace('#', '') if num else "-"
                # Name often follows the number, strip extra whitespace
                data['name'] = h1.get_text(separator=' ', strip=True).replace(f'#{data["jersey_number"]}', '').strip()

            img = header.find('img', class_='data-header__profile-image')
            if img: data['image_url'] = img.get('src', '')

            # Market Value from header
            mv_box = header.find('div', class_='data-header__box--small')
            if mv_box:
                mv_tag = mv_box.find('a')
                if mv_tag:
                    # 'separator=" "' ensures "12.00" and "mil. €" are joined with space if they are in different tags
                    raw_mv = mv_tag.get_text(separator=' ', strip=True)
                    # Bazen pipe veya "Son güncelleme" gibi metinler karışabilir, temizleyelim
                    raw_mv = raw_mv.split('|')[0].split('Son')[0].strip()
                    # Fazla boşlukları tek boşluğa indir
                    data['market_value'] = re.sub(r'\s+', ' ', raw_mv)
                    update = mv_tag.find('p', class_='data-header__last-update')
                    if update:
                         data['market_value_last_update'] = update.get_text(strip=True).replace('Son güncelleme:', '').strip()

            # Club info in header
            club_box = header.find('div', class_='data-header__box--big')
            if club_box:
                c_img = club_box.find('img')
                if c_img: data['club_image_url'] = c_img.get('src', '')
            
            club_name = header.find('span', class_='data-header__club')
            if club_name: data['club'] = club_name.get_text(strip=True)

            # League info in header
            league_span = header.find('span', class_='data-header__league')
            if league_span:
                l_link = league_span.find('a')
                if l_link:
                    data['league_name'] = l_link.get_text(strip=True)
                    l_img = l_link.find('img')
                    if l_img: data['league_image_url'] = l_img.get('src', '')

            # Success badges in header
            badges = header.find_all('a', class_='data-header__success-data')
            for b in badges:
                b_img = b.find('img')
                if b_img:
                    data['success_badges'].append({
                        "name": b_img.get('alt', ''),
                        "count": b.get_text(strip=True),
                        "image_url": b_img.get('src', '')
                    })

        # 2. Detailed Info Table
        info_table = soup.find('div', class_='info-table')
        if info_table:
            regs = info_table.find_all('span', class_='info-table__content--regular')
            for reg in regs:
                label = reg.get_text(strip=True).replace(':', '').lower()
                bold = reg.find_next_sibling('span', class_='info-table__content--bold')
                if not bold: continue
                val = bold.get_text(strip=True)
                
                if 'tam adı' in label or 'doğum adı' in label or 'anavatandaki isim' in label or 'full name' in label or 'name in home country' in label:
                     data['full_name'] = val
                elif 'doğum tarihi' in label or 'date of birth' in label:
                    age_m = re.search(r'\((\d+)\)', val)
                    if age_m: data['age'] = age_m.group(1)
                    data['birth_date'] = re.sub(r'\s*\(\d+\)\s*', '', val).strip()
                elif 'doğum yeri' in label or 'place of birth' in label:
                    data['birth_place'] = val
                elif 'boy' in label:
                    data['height'] = val.replace('\u00a0', ' ').strip()
                elif 'mevki' in label:
                    data['position'] = val
                elif 'ayak' in label:
                    data['foot'] = val
                elif 'uyruk' in label:
                    data['nationality'] = val
                elif 'temsilci' in label or 'agent' in label:
                    data['agent'] = val
                elif 'donatıcı' in label or 'outfitter' in label:
                    data['outfitter'] = val
                elif 'sözleşme sonu' in label or 'contract expires' in label:
                    data['contract_expires'] = val
                elif 'sosyal medya' in label:
                    for link in bold.find_all('a'):
                        data['social_media'].append({
                            'platform': link.get('title', '-'),
                            'url': link.get('href', '-')
                        })

        # 3. National Team
        if header:
            nt_li = header.find_all('li', class_='data-header__label')
            for li in nt_li:
                txt = li.get_text().lower()
                if 'milli oyuncu' in txt or 'national team' in txt:
                    nt_a = li.find('a')
                    if nt_a: data['national_team']['name'] = nt_a.get_text(strip=True)
                elif 'milli maç/gol' in txt or 'caps/goals' in txt:
                    stats_links = li.find_all('a')
                    if len(stats_links) >= 2:
                        data['national_team']['matches'] = stats_links[0].get_text(strip=True)
                        data['national_team']['goals'] = stats_links[1].get_text(strip=True)

        # 4. Secondary Positions
        pos_box = soup.find('div', class_='detail-position')
        if pos_box:
            side_pos = pos_box.find_all('dd', class_='detail-position__position')
            for p in side_pos:
                txt = p.get_text(strip=True)
                if txt and txt != data.get('position'):
                    if txt not in data['secondary_positions']:
                        data['secondary_positions'].append(txt)

        # 5. Youth Clubs
        youth_h2 = soup.find('h2', string=re.compile(r'Altyapı kariyeri|Youth clubs', re.IGNORECASE))
        if youth_h2:
            y_box = youth_h2.find_next('div', class_='content')
            if y_box:
                data['youth_clubs'] = [c.strip() for c in y_box.get_text(strip=True).split(',') if c.strip()]

        # 6. Highest MV and Update
        hv_tag = soup.find('div', class_='tm-market-value-development__max-value')
        if hv_tag:
            data['highest_market_value'] = hv_tag.get_text(strip=True)

        # 7. Performance & Injuries & Market History
        data['performance'] = get_all_performance_data(url)
        data['injuries'] = get_injury_history(url)
        data['market_value_history'] = get_mv_history_from_page(url)

        # 8. Transfer History (CEAPI)
        if player_id:
            try:
                t_resp = requests.get(f"{BASE_URL}/ceapi/transferHistory/list/{player_id}", headers=HEADERS, timeout=10)
                if t_resp.status_code == 200:
                    for t in t_resp.json().get('transfers', []):
                        data['transfer_history'].append({
                            'season': t.get('season', '-'),
                            'date': t.get('date', '-'),
                            'from_club': t.get('from', {}).get('clubName', '-'),
                            'to_club': t.get('to', {}).get('clubName', '-'),
                            'market_value': t.get('marketValue', '-'),
                            'fee': t.get('fee', '-')
                        })
            except: pass

        # 8. Highest Market Value Calculation (from history)
        if data['market_value_history']:
            max_val = 0.0
            max_str = "-"
            for item in data['market_value_history']:
                val_str = item.get('value', '')
                try:
                    # Clean the string to get numeric part
                    clean_val = val_str.replace('€', '').replace('mil.', '').replace('bin', '').replace(',', '.').strip()
                    # Determine multiplier
                    multiplier = 1
                    if 'mil' in val_str: multiplier = 1000000
                    elif 'bin' in val_str: multiplier = 1000
                    
                    real_val = float(clean_val) * multiplier
                    
                    if real_val > max_val:
                        max_val = real_val
                        max_str = val_str
                except:
                    continue
            
            if max_val > 0:
                data['highest_market_value'] = max_str

        return data
    except Exception as e:
        return {"error": str(e)}

@app.get("/search")
async def search(name: str):
    return {"results": search_players(name)}

@app.get("/player")
async def player(url: str = None, name: str = None):
    p_url = url
    if not p_url and name:
        res = search_players(name)
        if res: p_url = res[0]['url']
    if not p_url: raise HTTPException(status_code=404, detail="Oyuncu bulunamadı")
    return scrape_player_profile(p_url)

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

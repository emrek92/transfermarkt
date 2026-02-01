import requests
import json
from api import scrape_player_profile

def test_api():
    url = "https://www.transfermarkt.com.tr/arda-guler/profil/spieler/861410"
    try:
        data = scrape_player_profile(url)
        with open("test_output.json", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print("Success! Output written to test_output.json")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_api()
